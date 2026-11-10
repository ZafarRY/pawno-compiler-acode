import plugin from "../plugin.json";
import { compileWasm, EngineLoadError, shellToUrl } from "./wasm";
import {
    applyPawnTheme,
    applyToOpenFiles,
    registerPawnLanguage,
    registerPawnTheme
} from "./pawn-lang";
import {
    findTask,
    forShell,
    forWasm,
    resolveMain,
    type TaskPlan
} from "./task";
import { describePawnRows, installPawnIcon } from "./pawn-icon";
import {
    createPawnCompletion,
    describeCompletion,
    injectCompletionStyle,
    refreshProjectSymbols,
    syncCompletionScope
} from "./pawn-complete";

/* ------------------------------------------------------------------ */
/*  Pawno Compiler - Acode plugin untuk compile .pwn (SA-MP / open.mp) */
/*  Compile lewat Executor Acode (Alpine/proot).                       */
/*  Setup pawncc dijalankan di TERMINAL Acode yang terbuka otomatis.   */
/* ------------------------------------------------------------------ */

declare const Executor: any;

interface PawnSettings {
    compilerPath: string;
    useAlpine: boolean;
    autoSave: boolean;
    useWasm: boolean; // compile pakai pawncc.wasm (tanpa Alpine)
    syntaxHighlight: boolean; // pewarnaan syntax .pwn / .inc
    autoComplete: boolean; // saran fungsi/callback/snippet Pawn
    compilerFlags: string; // flag pawncc; kosong = DEFAULT_FLAGS
    extraIncludes: string; // folder include tambahan, dipisah koma
    setupCommand: string; // kosong = pakai DEFAULT_SETUP
    setupDeclined: boolean; // user menolak tawaran setup
    setupInstalled: boolean; // pawncc dipasang oleh setup plugin ini
}

// Flag bawaan bila project tidak punya .acode/task.json
const DEFAULT_FLAGS = "-d3 -;+ -(+";

const DEFAULTS: PawnSettings = {
    compilerPath: "pawncc",
    useAlpine: true,
    autoSave: true,
    useWasm: true,
    syntaxHighlight: true,
    autoComplete: true,
    compilerFlags: DEFAULT_FLAGS,
    extraIncludes: "",
    setupCommand: "",
    setupDeclined: false,
    setupInstalled: false
};

/**
 * Setup default: build pawncc dari source di dalam Alpine.
 * Best-effort - pawncc resmi 32-bit, jadi di arm64 hasilnya perlu dites.
 * Bisa diganti lewat setting "Perintah setup".
 */
const DEFAULT_SETUP = [
    "set -e",
    "exec 2>&1",
    "export GIT_TERMINAL_PROMPT=0",
    'echo "[setup] architecture: $(uname -m)"',
    'echo "[1/4] installing build packages..."',
    "apk add --no-cache git build-base cmake",
    'echo "[2/4] downloading pawncc source..."',
    "rm -rf /root/pawn-src",
    "OK=0",
    "for R in novusr/compiler gskeleton/compiler pawn-lang/compiler; do",
    '  echo "[setup] trying to clone $R"',
    '  if git clone --depth 1 "https://github.com/$R" /root/pawn-src; then OK=1; break; fi',
    "  rm -rf /root/pawn-src",
    "done",
    '[ "$OK" = 1 ] || { echo "[setup] all repos failed to clone"; exit 1; }',
    'echo "[3/4] building pawncc..."',
    "cd /root/pawn-src/source/compiler",
    'case "$(uname -m)" in x86_64|i386|i686) F="-m32";; *) F="";; esac',
    'if [ -z "$F" ]; then grep -rl "assert_static(sizeof(f)<=sizeof(cell))" /root/pawn-src/source 2>/dev/null | xargs -r sed -i "s/assert_static(sizeof(f)<=sizeof(cell));//"; fi',
    "mkdir -p build && cd build",
    'cmake .. -DCMAKE_C_STANDARD=99 -DCMAKE_C_FLAGS="$F" -DCMAKE_BUILD_TYPE=Release',
    "make -j2",
    'echo "[4/4] installing pawncc..."',
    'cp "$(find . -name pawncc -type f | head -1)" /usr/local/bin/pawncc',
    "cp \"$(find . -name 'libpawnc.so' | head -1)\" /usr/local/lib/libpawnc.so",
    "chmod +x /usr/local/bin/pawncc",
    'echo "[setup] done"'
].join("\n");

const CMD_COMPILE = "pawno-compile";
const CMD_SETUP = "pawno-setup";
const CMD_RESET = "pawno-reset";
const CMD_THEME = "pawno-theme";
const CMD_ICON_DEBUG = "pawno-icon-debug";
const CMD_COMPLETE_DEBUG = "pawno-complete-debug";
const BTN_ID = "pawno-compile-btn";
const EVENTS = [
    "switch-file",
    "rename-file",
    "file-loaded",
    "new-file",
    "remove-file",
    "save-file"
];
const ICON_SVG =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

// file yang dipakai untuk komunikasi dengan terminal setup (di dalam Alpine)
const SETUP_B64 = "/tmp/pawno-setup.b64";
const SETUP_SH = "/tmp/pawno-setup.sh";
const SETUP_STATUS = "/tmp/pawno-setup.status";

// "file.pwn(12) : error 017: undefined symbol "x""
const DIAG_RE =
    /^(.*?)\((\d+)(?:--\d+)?\)\s*:\s*(fatal error|error|warning)\s+(\d+):\s*(.*)$/;

const g = window as any;

/** Quote untuk shell (sh). */
function q(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

/** Flag compiler dari pengaturan (kosong -> DEFAULT_FLAGS). */
function flagsOf(s: PawnSettings): string[] {
    const f = (s.compilerFlags ?? "").trim();
    return (f || DEFAULT_FLAGS).split(/\s+/);
}

/** Folder include tambahan dari pengaturan (dipisah koma / baris baru). */
function extraIncludesOf(s: PawnSettings): string[] {
    return (s.extraIncludes ?? "")
        .split(/[,\n]+/)
        .map(x => x.trim())
        .filter(Boolean);
}

function toast(msg: string, ms = 2500) {
    const kind: ToastKind = /fail|error|not found|unavailable/i.test(msg)
        ? "error"
        : /no active|not installed|not a |already running|not available/i.test(
                msg
            )
          ? "warn"
          : /copied|success|done|ready|installed/i.test(msg)
            ? "success"
            : "info";
    if (!showToast(msg, "", kind, ms)) {
        try {
            g.toast(msg, ms);
        } catch {
            /* abaikan */
        }
    }
}

/** UTF-8 string -> base64 (aman untuk karakter non-ASCII). */
function toBase64(s: string): string {
    let bin = "";
    new TextEncoder().encode(s).forEach(b => {
        bin += String.fromCharCode(b);
    });
    return btoa(bin);
}

/** URL Acode -> path yang terlihat dari dalam terminal (/sdcard/...). */
function toShellPath(url: string): string | null {
    let u = url;
    try {
        u = decodeURIComponent(url);
    } catch {
        /* biarkan apa adanya */
    }
    if (u.startsWith("file://")) u = u.slice(7);

    const emu = u.match(/^\/storage\/emulated\/\d+\/(.*)$/);
    if (emu) return `/sdcard/${emu[1]}`;
    if (u.startsWith("/sdcard/")) return u;

    // SAF (content://...externalstorage...primary:Folder/...) - best effort
    if (u.startsWith("content://com.android.externalstorage.documents")) {
        const m = u.match(/primary:([^:]*)$/);
        if (m) return `/sdcard/${m[1]}`;
    }
    return null;
}

/**
 * Jalankan perintah via Executor, alirkan output ke onChunk.
 * timeoutMs > 0: proses dihentikan paksa kalau melewati batas (code = -1).
 */
function exec(
    cmd: string,
    alpine: boolean,
    onChunk: (text: string) => void,
    timeoutMs = 0
): Promise<{ code: number; out: string }> {
    return new Promise((resolve, reject) => {
        let out = "";
        let gotAny = false;
        let done = false;
        let uuid = "";
        let killer: ReturnType<typeof setTimeout> | null = null;

        const hint = setTimeout(() => {
            if (!gotAny)
                onChunk("\n[no response from Executor after 15 seconds]\n");
        }, 15000);

        const end = (code: number) => {
            if (done) return;
            done = true;
            clearTimeout(hint);
            if (killer) clearTimeout(killer);
            resolve({ code, out });
        };

        if (timeoutMs > 0) {
            killer = setTimeout(() => {
                const msg = `\n[timeout after ${Math.round(timeoutMs / 1000)} seconds, process stopped]\n`;
                out += msg;
                onChunk(msg);
                if (uuid) {
                    try {
                        Promise.resolve(Executor.stop(uuid)).catch(() => {});
                    } catch {
                        /* abaikan */
                    }
                }
                end(-1);
            }, timeoutMs);
        }

        try {
            Promise.resolve(
                Executor.start(
                    cmd,
                    (type: string, data: string) => {
                        gotAny = true;
                        if (type === "stdout" || type === "stderr") {
                            const line = data.endsWith("\n")
                                ? data
                                : `${data}\n`;
                            out += line;
                            onChunk(line);
                        } else if (type === "exit") {
                            end(Number(data));
                        } else {
                            onChunk(`\n[${type}] ${data}\n`);
                        }
                    },
                    alpine
                )
            )
                .then((id: string) => {
                    uuid = id;
                })
                .catch(e => {
                    clearTimeout(hint);
                    if (killer) clearTimeout(killer);
                    if (!done) {
                        done = true;
                        reject(e);
                    }
                });
        } catch (e) {
            clearTimeout(hint);
            if (killer) clearTimeout(killer);
            done = true;
            reject(e);
        }
    });
}

/* ------------------------- toast kustom (bawah) ------------------------- */

type ToastKind = "info" | "success" | "warn" | "error";

const TOAST_COLORS: Record<ToastKind, string> = {
    info: "#2563eb",
    success: "#16a34a",
    warn: "#d97706",
    error: "#dc2626"
};

const TOAST_CSS = `
.pwn-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);z-index:100000;
transform:translate(-50%,24px);opacity:0;width:max-content;max-width:calc(100vw - 32px);
padding:10px 16px;border-radius:12px;color:#fff;font:600 13.5px/1.35 system-ui,-apple-system,Roboto,sans-serif;
box-shadow:0 6px 18px rgba(0,0,0,.4);text-align:center;
transition:transform .25s ease,opacity .25s ease}
.pwn-toast.in{transform:translate(-50%,0);opacity:1}
.pwn-toast.out{transform:translate(-50%,24px);opacity:0}
.pwn-toast-s{font-weight:400;font-size:11.5px;opacity:.85;margin-top:2px}
@media (prefers-reduced-motion:reduce){.pwn-toast,.pwn-toast.out{transition:opacity .2s;transform:translate(-50%,0)}}
`;

/** Toast sederhana berwarna di bagian bawah layar. Ketuk untuk menutup. */
function showToast(
    title: string,
    sub = "",
    kind: ToastKind = "info",
    ms = 2500
): boolean {
    try {
        document.getElementById("pwn-toast")?.remove();
        if (!document.getElementById("pwn-toast-style")) {
            const st = document.createElement("style");
            st.id = "pwn-toast-style";
            st.textContent = TOAST_CSS;
            document.head.appendChild(st);
        }
        const t = document.createElement("div");
        t.id = "pwn-toast";
        t.className = "pwn-toast";
        t.style.background = TOAST_COLORS[kind];
        t.setAttribute("role", "status");
        const head = document.createElement("div");
        head.textContent = title;
        t.appendChild(head);
        if (sub) {
            const s2 = document.createElement("div");
            s2.className = "pwn-toast-s";
            s2.textContent = sub;
            t.appendChild(s2);
        }
        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            t.classList.remove("in");
            t.classList.add("out");
            setTimeout(() => t.remove(), 300);
        };
        t.onclick = close;
        document.body.appendChild(t);
        requestAnimationFrame(() =>
            requestAnimationFrame(() => t.classList.add("in"))
        );
        setTimeout(close, ms);
        return true;
    } catch {
        return false;
    }
}

/** Toast sambutan saat plugin dimuat. */
function showLoadToast(title: string, sub: string, ms = 3200) {
    showToast(title, sub, "success", ms);
}

/* ------------------------- tampilan log compile ------------------------- */

const VIEW_CSS = `
.pwn-o{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;
background:var(--primary-color,#14181f);color:var(--primary-text-color,#e6edf3);
font-family:system-ui,-apple-system,Roboto,sans-serif;
padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);
animation:pwn-in .18s ease-out}
@keyframes pwn-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes pwn-sp{to{transform:rotate(360deg)}}
.pwn-bar{display:flex;align-items:center;gap:10px;padding:10px 12px;flex-shrink:0;
border-bottom:1px solid rgba(128,128,128,.25)}
.pwn-title{flex:1;min-width:0;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pwn-spin{width:16px;height:16px;border-radius:50%;flex-shrink:0;border:2.5px solid rgba(128,128,128,.35);
border-top-color:#60a5fa;animation:pwn-sp .8s linear infinite}
.pwn-btn{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;
background:rgba(128,128,128,.15);cursor:pointer;font-size:16px;flex-shrink:0;user-select:none}
.pwn-btn:active{background:rgba(128,128,128,.32)}
.pwn-scroll{flex:1;overflow:auto;padding:12px;-webkit-overflow-scrolling:touch}
.pwn-hero{display:flex;align-items:center;gap:14px;padding:16px;border-radius:16px;margin-bottom:12px;border:1px solid}
.pwn-hero.ok{background:linear-gradient(135deg,rgba(74,222,128,.24),rgba(74,222,128,.05));border-color:rgba(74,222,128,.5)}
.pwn-hero.bad{background:linear-gradient(135deg,rgba(248,113,113,.26),rgba(248,113,113,.05));border-color:rgba(248,113,113,.5)}
.pwn-ico{width:46px;height:46px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;
font-size:24px;font-weight:800;color:#0b1220}
.ok .pwn-ico{background:#4ade80;box-shadow:0 0 18px rgba(74,222,128,.5)}
.bad .pwn-ico{background:#f87171;box-shadow:0 0 18px rgba(248,113,113,.5)}
.pwn-ht{font-size:16px;font-weight:700}
.pwn-hs{font-size:12px;opacity:.72;margin-top:3px;overflow-wrap:anywhere}
.pwn-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.pwn-chip{padding:7px 13px;border-radius:999px;font-size:12px;font-weight:700;cursor:pointer;user-select:none;
border:1px solid rgba(128,128,128,.3);background:rgba(128,128,128,.1)}
.pwn-chip.on{background:rgba(96,165,250,.25);border-color:#60a5fa}
.pwn-chip.e{color:#f87171}.pwn-chip.w{color:#fbbf24}
.pwn-chip.e.on{background:rgba(248,113,113,.25);border-color:#f87171}
.pwn-chip.w.on{background:rgba(251,191,36,.25);border-color:#fbbf24}
.pwn-d{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;margin-bottom:8px;border-radius:12px;
background:rgba(128,128,128,.1);border-left:4px solid;cursor:pointer}
.pwn-d:active{background:rgba(128,128,128,.2)}
.pwn-d.e{border-color:#f87171}.pwn-d.w{border-color:#fbbf24}
.pwn-tag{font:700 10px/1 ui-monospace,monospace;padding:5px 7px;border-radius:6px;white-space:nowrap;flex-shrink:0}
.e .pwn-tag{background:rgba(248,113,113,.2);color:#f87171}
.w .pwn-tag{background:rgba(251,191,36,.2);color:#fbbf24}
.pwn-dm{font-size:13.5px;line-height:1.4;overflow-wrap:anywhere}
.pwn-dl{font:11.5px ui-monospace,monospace;opacity:.65;margin-top:4px;overflow-wrap:anywhere}
.pwn-go{margin-left:auto;opacity:.5;font-size:18px;align-self:center}
.pwn-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0 12px}
.pwn-st{padding:10px 12px;border-radius:12px;background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.25)}
.pwn-st.tot{grid-column:1/-1;background:rgba(74,222,128,.1);border-color:rgba(74,222,128,.35)}
.pwn-sl{font-size:10.5px;opacity:.65;text-transform:uppercase;letter-spacing:.6px}
.pwn-sv{font:700 16px ui-monospace,monospace;margin-top:3px}
.pwn-ss{font-size:11px;opacity:.6;margin-top:2px;overflow-wrap:anywhere}
.pwn-raw summary{cursor:pointer;font-size:12px;font-weight:700;opacity:.75;padding:8px 2px;user-select:none}
.pwn-pre{margin:0;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.28);
font:12px/1.55 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}
`;

const STAT_RE =
    /^(Header size|Code size|Data size|Stack\/heap size|Total requirements):\s*(.*)$/;
const STAT_LABEL: Record<string, string> = {
    "Header size": "Header",
    "Code size": "Code",
    "Data size": "Data",
    "Stack/heap size": "Stack / Heap",
    "Total requirements": "Total"
};

function ensureViewStyle() {
    if (document.getElementById("pwn-style")) return;
    const s = document.createElement("style");
    s.id = "pwn-style";
    s.textContent = VIEW_CSS;
    document.head.appendChild(s);
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls = "",
    text = ""
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
}

function sameUri(a: string, b: string): boolean {
    const n = (u: string) => {
        try {
            return decodeURIComponent(u).replace(/\/+$/, "");
        } catch {
            return u;
        }
    };
    return a === b || n(a) === n(b);
}

/** Buka file (atau pindah ke tab-nya bila sudah terbuka) lalu loncat ke baris. */
async function openFileAt(url: string, name: string, line: number) {
    const em = g.editorManager;
    let f: any = null;
    try {
        f = em.getFile(url, "uri");
    } catch {
        /* belum terbuka */
    }
    try {
        if (f) em.switchFile(f.id);
        else f = (acode as any).newEditorFile(name, { uri: url, render: true });
    } catch (e: any) {
        toast(`Failed to open ${name}: ${e?.message ?? e}`, 3000);
        return;
    }
    for (let i = 0; i < 40; i++) {
        // tunggu tab aktif dan isi file selesai dimuat (maks ±4 detik)
        await sleep(100);
        const ed = em.editor;
        if (
            em.activeFile?.id === f?.id &&
            ed?.state?.doc &&
            ed.state.doc.lines >= line
        )
            break;
    }
    jumpToLine(line);
}

/** Loncat ke baris: CodeMirror 6 (Acode baru), dengan cadangan API Ace (Acode lama). */
function jumpToLine(n: number) {
    const ed = g.editorManager.editor;
    try {
        if (ed?.state?.doc && typeof ed.dispatch === "function") {
            const line = ed.state.doc.line(
                Math.min(Math.max(n, 1), ed.state.doc.lines)
            );
            ed.dispatch({
                selection: { anchor: line.from },
                scrollIntoView: true
            });
        } else if (typeof ed?.gotoLine === "function") {
            ed.gotoLine(n, 0, true);
        }
        ed?.focus?.();
    } catch {
        /* abaikan */
    }
}

interface Diag {
    path: string; // path persis seperti dicetak compiler
    file: string;
    line: number;
    kind: "e" | "w";
    tag: string;
    msg: string;
}

/** Layar output penuh (overlay sendiri); teks live saat jalan, lalu dirender rapi di finish(). */
class OutputView {
    overlay = el("div", "pwn-o");
    head = el("div", "pwn-title");
    spin = el("div", "pwn-spin");
    scroller = el("div", "pwn-scroll");
    live = el("pre", "pwn-pre");
    buffer = "";
    startedAt = Date.now();

    constructor(title: string) {
        ensureViewStyle();
        this.head.textContent = title;

        const copy = el("div", "pwn-btn", "⧉");
        copy.title = "Copy log";
        copy.onclick = () => {
            try {
                void navigator.clipboard.writeText(this.buffer);
                toast("Log copied", 1200);
            } catch {
                toast("Copy failed", 1500);
            }
        };
        const close = el("div", "pwn-btn", "✕");
        close.onclick = () => this.close();

        const bar = el("div", "pwn-bar");
        bar.append(this.spin, this.head, copy, close);
        this.scroller.appendChild(this.live);
        this.overlay.append(bar, this.scroller);
        document.body.appendChild(this.overlay);
    }

    close() {
        this.overlay.remove();
    }

    append(text: string) {
        this.buffer += text;
        this.live.textContent = this.buffer;
        this.scroller.scrollTop = this.scroller.scrollHeight;
    }

    /** resolve: path dari log compiler -> URL file asli (untuk membuka file include). */
    finish(
        title: string,
        ok: boolean,
        fileName = "",
        resolve?: (path: string) => string | null
    ) {
        this.spin.remove();
        this.head.textContent = title;
        const secs = ((Date.now() - this.startedAt) / 1000).toFixed(1);

        // --- parse log ---
        const diags: Diag[] = [];
        const stats: Array<[string, string]> = [];
        for (const raw of this.buffer.split("\n")) {
            const line = raw.replace(/\t/g, " ").trimEnd();
            const d = line.match(DIAG_RE);
            if (d) {
                const fatal = d[3] === "fatal error";
                diags.push({
                    path: d[1],
                    file: d[1].split(/[\\/]/).pop() || d[1],
                    line: Number(d[2]),
                    kind: d[3] === "warning" ? "w" : "e",
                    tag: `${fatal ? "FATAL" : d[3] === "warning" ? "WARN" : "ERROR"} ${d[4]}`,
                    msg: d[5]
                });
                continue;
            }
            const s = line.match(STAT_RE);
            if (s) stats.push([s[1], s[2].trim()]);
        }
        const errs = diags.filter(x => x.kind === "e").length;
        const warns = diags.length - errs;

        // --- render ---
        const sc = this.scroller;
        sc.textContent = "";

        const hero = el("div", `pwn-hero ${ok ? "ok" : "bad"}`);
        const sub = ok
            ? warns
                ? `Finished with ${warns} warning(s)`
                : "No errors or warnings"
            : `${errs || 1} error(s) found`;
        const txt = el("div");
        txt.append(
            el("div", "pwn-ht", ok ? "Compile succeeded" : "Compile failed"),
            el(
                "div",
                "pwn-hs",
                `${sub} • ${secs}s${fileName ? ` • ${fileName}` : ""}`
            )
        );
        hero.append(el("div", "pwn-ico", ok ? "✓" : "✕"), txt);
        sc.appendChild(hero);

        // filter + daftar diagnostik
        if (diags.length) {
            let filter: "all" | "e" | "w" = "all";
            const chips = el("div", "pwn-chips");
            const list = el("div");
            const mk = (key: "all" | "e" | "w", label: string, cls: string) => {
                const c = el("div", `pwn-chip ${cls}`, label);
                c.onclick = () => {
                    filter = key;
                    chips.childNodes.forEach(n =>
                        (n as HTMLElement).classList.remove("on")
                    );
                    c.classList.add("on");
                    draw();
                };
                if (key === "all") c.classList.add("on");
                chips.appendChild(c);
            };
            mk("all", `All ${diags.length}`, "");
            if (errs) mk("e", `● ${errs} Error`, "e");
            if (warns) mk("w", `● ${warns} Warning`, "w");

            const draw = () => {
                list.textContent = "";
                for (const d of diags) {
                    if (filter !== "all" && d.kind !== filter) continue;
                    const row = el("div", `pwn-d ${d.kind}`);
                    const body = el("div");
                    body.append(
                        el("div", "pwn-dm", d.msg),
                        el("div", "pwn-dl", `${d.file}:${d.line}`)
                    );
                    row.append(
                        el("div", "pwn-tag", d.tag),
                        body,
                        el("div", "pwn-go", "›")
                    );
                    row.onclick = () => {
                        const active = g.editorManager.activeFile;
                        let url: string | null = null;
                        try {
                            url = resolve?.(d.path) ?? null;
                        } catch {
                            url = null;
                        }
                        if (url) {
                            this.close();
                            if (active?.uri && sameUri(active.uri, url))
                                jumpToLine(d.line);
                            else void openFileAt(url, d.file, d.line);
                        } else if (
                            active &&
                            (d.file === active.name || d.file === fileName)
                        ) {
                            this.close();
                            jumpToLine(d.line);
                        } else {
                            toast(`Cannot open ${d.file}:${d.line}`, 2500);
                        }
                    };
                    list.appendChild(row);
                }
            };
            draw();
            sc.append(chips, list);
        }

        // statistik ukuran
        if (stats.length) {
            const grid = el("div", "pwn-grid");
            for (const [k, v] of stats) {
                const [main, extra] = v.split(";").map(x => x.trim());
                const card = el(
                    "div",
                    `pwn-st${k === "Total requirements" ? " tot" : ""}`
                );
                card.append(
                    el("div", "pwn-sl", STAT_LABEL[k] ?? k),
                    el("div", "pwn-sv", main)
                );
                if (extra) card.appendChild(el("div", "pwn-ss", extra));
                grid.appendChild(card);
            }
            sc.appendChild(grid);
        }

        // log mentah (terlipat bila sudah ada ringkasan)
        const raw = el("details", "pwn-raw");
        if (!diags.length && !stats.length) raw.open = true;
        const pre = el("pre", "pwn-pre");
        pre.textContent = this.buffer.trim();
        raw.append(el("summary", "", "Raw log"), pre);
        sc.appendChild(raw);
        sc.scrollTop = 0;
    }
}

class AcodePlugin {
    baseUrl = "";
    btn: HTMLElement | null = null;
    busy = false;
    timer: ReturnType<typeof setInterval> | null = null;
    undoLang: (() => void) | null = null;
    undoTheme: (() => void) | null = null;
    undoStyle: (() => void) | null = null;
    undoIcon: (() => void) | null = null;
    fileIcons: any = null;
    onFileChange = () =>
        setTimeout(() => {
            this.updateButton();
            syncCompletionScope();
            void refreshProjectSymbols(); // pindai ulang .inc (ditunda & dibatasi di dalam)
        }, 0);

    get settings(): PawnSettings {
        const app = acode.require("settings") as any;
        const cur = app.value[plugin.id] ?? {};
        const merged = { ...DEFAULTS, ...cur };
        if (JSON.stringify(cur) !== JSON.stringify(merged)) {
            app.value[plugin.id] = merged;
            app.update(false);
        }
        return app.value[plugin.id] as PawnSettings;
    }

    setSetting<K extends keyof PawnSettings>(key: K, value: PawnSettings[K]) {
        const app = acode.require("settings") as any;
        this.settings; // pastikan terinisialisasi (juga setelah reset)
        app.value[plugin.id][key] = value;
        app.update(false);
    }

    get settingsObject() {
        const s = this.settings;
        return {
            list: [
                {
                    key: "compilerPath",
                    text: "Path pawncc",
                    info: "pawncc command/path inside the terminal, e.g. pawncc or /usr/local/bin/pawncc",
                    value: s.compilerPath,
                    prompt: "Path pawncc",
                    promptType: "text"
                },
                {
                    key: "setupCommand",
                    text: "Setup command (optional)",
                    info: "Shell script to install pawncc. Empty = build from source automatically",
                    value: s.setupCommand,
                    prompt: "Setup command",
                    promptType: "text"
                },
                {
                    key: "compilerFlags",
                    text: "Compiler flags",
                    info: "Default: -d3 -;+ -(+ . Ignored when the project has .acode/task.json",
                    value: s.compilerFlags,
                    prompt: "Compiler flags",
                    promptType: "text"
                },
                {
                    key: "extraIncludes",
                    text: "Extra include folders",
                    info: "Include folders, comma-separated, e.g. /sdcard/Acode/pawno/include",
                    value: s.extraIncludes,
                    prompt: "Include folders",
                    promptType: "text"
                },
                {
                    key: "useWasm",
                    text: "Use pawncc.wasm (no Alpine needed)",
                    checkbox: s.useWasm !== false
                },
                {
                    key: "useAlpine",
                    text: "Run in Alpine (proot)",
                    checkbox: !!s.useAlpine
                },
                {
                    key: "autoSave",
                    text: "Auto-save before compile",
                    checkbox: !!s.autoSave
                },
                {
                    key: "autoComplete",
                    text: "Autocomplete & snippet Pawn",
                    info: "Suggests callbacks, natives and symbols from project .inc files (needs syntax highlighting on)",
                    checkbox: s.autoComplete !== false
                },
                {
                    key: "syntaxHighlight",
                    text: "Pawn syntax highlighting (.pwn / .inc)",
                    info: "Takes effect after restarting Acode",
                    checkbox: s.syntaxHighlight !== false
                }
            ],
            // aman walau settings sudah di-reset (setSetting menginisialisasi ulang)
            cb: (key: string, value: unknown) => {
                this.setSetting(key as keyof PawnSettings, value as never);
            }
        };
    }

    async init(
        _page: Acode.WCPage,
        _cacheFile: Acode.FileSystem,
        _cacheFileUrl: string,
        firstInit = false
    ): Promise<void> {
        const commands = acode.require("commands") as any;
        commands.addCommand({
            name: CMD_COMPILE,
            description: "Pawn: Compile active file",
            exec: () => void this.compile()
        });
        commands.addCommand({
            name: CMD_SETUP,
            description: "Pawn: Setup compiler (install pawncc)",
            exec: () => void this.setup(true)
        });
        commands.addCommand({
            name: CMD_RESET,
            description: "Pawn: Remove setup (pawncc & settings)",
            exec: () =>
                void this.cleanup(true).then(() =>
                    toast(
                        "Pawno setup removed. Run 'Pawn: Setup compiler' to install again.",
                        4000
                    )
                )
        });

        commands.addCommand({
            name: CMD_THEME,
            description: "Pawn: Use Pawno Night theme",
            exec: () =>
                toast(
                    applyPawnTheme()
                        ? "Pawno Night theme enabled"
                        : "This Acode version does not support custom themes",
                    2500
                )
        });

        commands.addCommand({
            name: CMD_ICON_DEBUG,
            description: "Pawn: Debug .pwn icon",
            exec: () => {
                const v = new OutputView("Icon debug");
                v.append(describePawnRows());
                v.finish("Icon debug", true);
            }
        });

        commands.addCommand({
            name: CMD_COMPLETE_DEBUG,
            description: "Pawn: Debug autocomplete",
            exec: async () => {
                await refreshProjectSymbols(true);
                const v = new OutputView("Debug autocomplete");
                v.append(describeCompletion());
                v.finish("Debug autocomplete", true);
            }
        });

        // Pewarnaan syntax .pwn / .inc (Acode berbasis CodeMirror 6)
        if (this.settings.syntaxHighlight !== false) {
            try {
                this.undoLang = registerPawnLanguage(
                    createPawnCompletion(
                        () => this.settings.autoComplete !== false
                    )
                );
                this.undoTheme = registerPawnTheme();
                this.undoStyle = injectCompletionStyle();
                if (this.undoLang) {
                    applyToOpenFiles();
                    setTimeout(applyToOpenFiles, 1500); // file yang dipulihkan saat Acode dibuka
                    setTimeout(() => void refreshProjectSymbols(true), 1800);
                }
            } catch (e: any) {
                toast(
                    `Pawno: failed to enable highlighting (${e?.message ?? e})`,
                    4000
                );
            }
        }

        // Ikon pion untuk file .pwn di tab & sidebar
        try {
            const ic = installPawnIcon({
                fileIcons: this.fileIcons,
                baseUrl: this.baseUrl,
                id: plugin.id
            });
            this.undoIcon = ic.undo;
            if (ic.packRegistered && firstInit) {
                setTimeout(
                    () =>
                        toast(
                            ".pwn icon: choose 'Pawno Compiler' in Settings > App settings > Icon pack",
                            7000
                        ),
                    3500
                );
            }
        } catch (e: any) {
            toast(`Pawno: failed to install icon (${e?.message ?? e})`, 4000);
        }

        this.createButton();
        for (const ev of EVENTS) g.editorManager.on(ev, this.onFileChange);
        this.updateButton();
        setTimeout(() => showLoadToast("Pawno Compiler ready", ""), 400);
        // Cadangan: sinkronkan tombol berkala (header bisa dibuat ulang / event terlewat)
        this.timer = setInterval(() => this.updateButton(), 1500);

        // Tawaran setup hanya sekali setelah install pertama (init harus cepat).
        // Setelah itu, setup ditawarkan lazy saat user menekan Compile.
        if (firstInit) {
            this.setSetting("setupDeclined", false);
            setTimeout(() => void this.firstRunSetup(), 2500);
        }
    }

    async destroy(): Promise<void> {
        // Lepas semua yang dipasang init (sinkron, wajib).
        // Penghapusan pawncc/pengaturan sengaja TIDAK otomatis (unmount juga
        // terpanggil saat disable/reload/update) - pakai command "Pawn: Hapus setup".
        const commands = acode.require("commands") as any;
        commands.removeCommand(CMD_COMPILE);
        commands.removeCommand(CMD_SETUP);
        commands.removeCommand(CMD_RESET);
        commands.removeCommand(CMD_THEME);
        commands.removeCommand(CMD_ICON_DEBUG);
        commands.removeCommand(CMD_COMPLETE_DEBUG);
        this.undoLang?.();
        this.undoTheme?.();
        this.undoStyle?.();
        this.undoLang = this.undoTheme = this.undoStyle = null;
        this.undoIcon?.();
        this.undoIcon = null;
        for (const ev of EVENTS) g.editorManager.off(ev, this.onFileChange);
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.btn?.remove();
        this.btn = null;
    }

    /** Reset pengaturan plugin dan (opsional) hapus pawncc yang dipasang setup. */
    async cleanup(removeFiles: boolean): Promise<void> {
        const snap = { ...this.settings };
        const app = acode.require("settings") as any;
        delete app.value[plugin.id];
        app.update(false);

        if (
            removeFiles &&
            snap.setupInstalled &&
            typeof Executor !== "undefined"
        ) {
            try {
                await exec(
                    `sh -c ${q("rm -f /usr/local/bin/pawncc /usr/local/lib/libpawnc.so; rm -rf /root/pawn-src")}`,
                    !!snap.useAlpine,
                    () => {},
                    15000
                );
            } catch {
                /* abaikan */
            }
        }
    }

    async firstRunSetup(): Promise<void> {
        try {
            if (this.settings.useWasm !== false) return; // wasm aktif: tidak perlu setup Alpine
            if (typeof Executor === "undefined") return;
            if (this.settings.setupDeclined) return;
            if (await this.hasCompiler()) return;
            const r = await this.setup(false);
            if (r === "declined") this.setSetting("setupDeclined", true);
        } catch (e: any) {
            toast(`Pawno setup: ${e?.message ?? e}`, 4000);
        }
    }

    /** Tombol di header, di kiri titik tiga. */
    createButton(): void {
        const header: HTMLElement | null =
            g.editorManager.header ?? document.querySelector("header");
        if (!header) {
            toast("Pawno: Acode header not found", 4000);
            return;
        }
        document.getElementById(BTN_ID)?.remove();

        const btn = document.createElement("span");
        btn.id = BTN_ID;
        btn.className = "icon"; // ikut gaya ikon header Acode (area ketuk 40x40)
        btn.title = "Compile Pawn";
        btn.setAttribute("role", "button");
        btn.innerHTML = ICON_SVG;
        btn.style.cssText =
            "display:none;align-items:center;justify-content:center;" +
            "width:40px;height:40px;flex-shrink:0;cursor:pointer;" +
            "position:relative;z-index:10;pointer-events:auto;" +
            "color:var(--primary-text-color,#fff);";

        // Header Acode bisa menangkap sentuhan sebelum 'click' sampai ke tombol,
        // jadi pasang touchend + click, dengan penjaga supaya tidak jalan dua kali.
        let lastTap = 0;
        const fire = (ev: Event) => {
            ev.stopPropagation();
            if (ev.cancelable) ev.preventDefault();
            const now = Date.now();
            if (now - lastTap < 500) return;
            lastTap = now;
            toast("Pawn: starting...", 1000);
            this.compile().catch((e: any) =>
                toast(`Pawn error: ${e?.message ?? e}`, 5000)
            );
        };
        btn.addEventListener("touchend", fire, { passive: false });
        btn.addEventListener("click", fire);

        // Cari tombol menu (titik tiga) lewat selector yang dikenal; tanpa tebak-tebakan ukuran.
        const menu = header.querySelector(
            '[action="toggle-menu"], .icon.more_vert, .more_vert'
        ) as HTMLElement | null;
        if (menu && menu.parentElement)
            menu.parentElement.insertBefore(btn, menu);
        else header.appendChild(btn);
        this.btn = btn;
    }

    /** Tampil hanya untuk file .pwn / .p */
    updateButton(): void {
        if (!this.btn) return;
        if (!this.btn.isConnected) this.createButton();
        if (!this.btn) return;
        const f = g.editorManager.activeFile;
        const show = !!f && /\.(pwn|p|inc)$/i.test(f.name || f.filename || "");
        this.btn.style.display = show ? "flex" : "none";

        // Jaga urutan header seperti bawaan: ... [edit] [Compile] [menu]
        const header: HTMLElement | null =
            g.editorManager.header ?? document.querySelector("header");
        const menu = header?.querySelector(
            '[action="toggle-menu"], .icon.more_vert, .more_vert'
        ) as HTMLElement | null;
        if (
            menu?.parentElement &&
            menu.parentElement === this.btn.parentElement &&
            this.btn.nextElementSibling !== menu
        )
            menu.parentElement.insertBefore(this.btn, menu);
    }

    /** Apakah pawncc sudah bisa dipanggil? */
    async hasCompiler(): Promise<boolean> {
        const s = this.settings;
        const c = s.compilerPath;
        const { code } = await exec(
            `sh -c ${q(`command -v ${q(c)} >/dev/null 2>&1 || test -x ${q(c)}`)}`,
            !!s.useAlpine,
            () => {},
            30000
        );
        return code === 0;
    }

    /**
     * Jalankan script setup di TERMINAL Acode (terbuka otomatis supaya
     * prosesnya kelihatan). Script dikirim lewat base64 per potongan agar tidak
     * melewati batas panjang baris terminal (4096). Hasil dibaca dari file status.
     */
    async setupInTerminal(script: string): Promise<boolean> {
        const terminal = acode.require("terminal") as any;
        if (!terminal) throw new Error("terminal module not available");

        // 1) Tulis script ke /tmp lewat Executor (jalur yang sudah terbukti jalan)
        const b64 = toBase64(`${script}\n`);
        const st = await exec(
            `sh -c ${q(`rm -f ${SETUP_STATUS}; printf %s ${q(b64)} | base64 -d > ${SETUP_SH} && echo staged`)}`,
            true,
            () => {},
            30000
        );
        if (!st.out.includes("staged"))
            throw new Error("failed to write setup script to /tmp");

        // 2) Buka terminal (coba beberapa cara)
        const errs: string[] = [];
        let term: any = null;
        const makers: Array<() => Promise<any>> = [
            () => terminal.createServer({ name: "Pawno Setup" }),
            () => terminal.create({ name: "Pawno Setup", serverMode: true })
        ];
        for (const mk of makers) {
            try {
                term = await mk();
                if (term && term.id !== undefined) break;
                term = null;
            } catch (e: any) {
                errs.push(String(e?.message ?? e));
            }
        }
        if (!term)
            throw new Error(
                `failed to open terminal: ${errs.join(" | ") || "no response"}`
            );
        const id = term.id;

        await sleep(1500); // beri waktu shell siap

        // 3) Satu baris pendek saja yang diketik ke terminal
        await Promise.resolve(
            terminal.write(
                id,
                `sh ${SETUP_SH}; R=$?; echo $R > ${SETUP_STATUS}; echo; echo "[pawno] setup finished (code: $R)"\r`
            )
        );

        // tunggu sampai file status muncul / compiler terdeteksi / terminal ditutup
        const startedAt = Date.now();
        while (Date.now() - startedAt < 40 * 60 * 1000) {
            await sleep(4000);
            try {
                const { out } = await exec(
                    `sh -c ${q(`cat ${SETUP_STATUS} 2>/dev/null`)}`,
                    true,
                    () => {},
                    15000
                );
                const st = out.trim();
                if (st !== "") return Number(st) === 0;
                if (await this.hasCompiler()) return true;
            } catch {
                /* coba lagi */
            }
            let alive = true;
            try {
                alive = !!terminal.get(id);
            } catch {
                /* abaikan */
            }
            if (!alive) break;
        }
        return this.hasCompiler();
    }

    /** Pasang pawncc. ask=true -> tidak perlu konfirmasi (dipanggil manual). */
    async setup(ask: boolean): Promise<"ok" | "failed" | "declined"> {
        if (typeof Executor === "undefined") {
            toast(
                "Executor not available - update Acode / enable terminal",
                4000
            );
            return "failed";
        }
        if (!ask) {
            const ok = await (acode.require("confirm") as any)(
                "Pawno Compiler",
                "pawncc is not installed. Install now? (needs internet, may take a few minutes; a terminal will open)"
            );
            if (!ok) return "declined";
        }

        const s = this.settings;
        const script = s.setupCommand.trim() || DEFAULT_SETUP;

        // Jalur utama: terminal Acode (hanya bila Alpine dipakai & modul tersedia)
        let why = "";
        if (!s.useAlpine) {
            why = "'Run in Alpine' is turned off in settings";
        } else {
            try {
                toast("Opening terminal for setup...", 2000);
                const ok = await this.setupInTerminal(script);
                if (ok) this.setSetting("setupInstalled", true);
                toast(
                    ok
                        ? "pawncc setup done"
                        : "pawncc setup failed - check the terminal",
                    4000
                );
                return ok ? "ok" : "failed";
            } catch (e: any) {
                why = String(e?.message ?? e);
            }
        }

        // Cadangan: layar output plugin (Executor). Alasan terminal tidak dipakai ditampilkan.
        const view = new OutputView("Setting up pawncc...");
        view.append(
            `[plugin] terminal not used: ${why}\n[plugin] continuing setup on this screen...\n\n`
        );
        try {
            const { code } = await exec(
                `sh -c ${q(script)}`,
                !!s.useAlpine,
                t => view.append(t)
            );
            const ok = code === 0;
            if (ok) this.setSetting("setupInstalled", true);
            view.finish(ok ? "Setup done" : `Setup failed (code ${code})`, ok);
            return ok ? "ok" : "failed";
        } catch (e: any) {
            view.append(`\n${e?.message ?? e}`);
            view.finish("Setup failed", false);
            return "failed";
        }
    }

    /**
     * Compile lewat pawncc.wasm. true = sudah ditangani (sukses maupun error compile),
     * false = engine gagal dimuat -> pemanggil lanjut ke jalur Alpine.
     */
    async compileWithWasm(
        file: any,
        target: { uri: string; name: string },
        s: PawnSettings,
        note = ""
    ): Promise<boolean> {
        this.busy = true;
        let view: OutputView | null = null;
        try {
            if (s.autoSave && file.isUnsaved) {
                try {
                    await file.save();
                } catch {
                    /* lanjut saja */
                }
            }
            view = new OutputView("Compiling...");
            const v = view;
            if (note) v.append(note);
            // Flag & include diambil dari .acode/task.json di project (bila ada)
            let plan: TaskPlan | null = null;
            try {
                plan = await findTask(target.uri);
            } catch (e: any) {
                v.append(`[task] ${e?.message ?? e}; using plugin settings\n`);
            }
            let taskArgs: string[] | undefined;
            let includeUrls: string[] = [];
            if (plan) {
                const w = forWasm(plan, target.name);
                taskArgs = w.args;
                includeUrls = w.includeUrls;
                v.append(`[task] ${plan.label} ← .acode/task.json\n`);
                if (w.skipped.length)
                    v.append(
                        `[task] includes skipped (cannot be mapped): ${w.skipped.join(", ")}\n`
                    );
            }

            const flags = flagsOf(s);
            const extra = extraIncludesOf(s);

            const r = await compileWasm({
                baseUrl: this.baseUrl,
                fileUrl: target.uri,
                fileName: target.name,
                flags,
                extraIncludes: extra,
                includeUrls,
                taskArgs,
                onChunk: t => v.append(t)
            });

            if (r.truncated)
                v.append(
                    "\n[wasm] some files were not loaded (count/size limit)\n"
                );
            if (r.code === 0 && !r.saved)
                v.append(
                    `\n[wasm] compile succeeded but ${r.outName} could not be saved\n`
                );
            if (!v.buffer.trim()) v.append("(no output)");
            const ok = r.code === 0;
            v.finish(
                ok ? `Compile succeeded → ${r.outName}` : "Compile failed",
                ok,
                target.name,
                p => {
                    // path virtual compiler (/w/x.pwn, /i0/a_samp.inc) -> URL file asli
                    let k = p.replace(/\\/g, "/").replace(/^\.\//, "");
                    if (!k.startsWith("/")) k = `/w/${k}`;
                    if (r.fileMap[k]) return r.fileMap[k];
                    const base = k.split("/").pop();
                    const hits = Object.keys(r.fileMap).filter(
                        x => x.split("/").pop() === base
                    );
                    return hits.length === 1 ? r.fileMap[hits[0]] : null;
                }
            );
            return true;
        } catch (e: any) {
            if (e instanceof EngineLoadError) {
                view?.close();
                toast(
                    `pawncc.wasm failed to load (${e.message}), using Alpine`,
                    4000
                );
                return false;
            }
            view?.append(`\nCompile error:\n${e?.message ?? e}`);
            view?.finish("Compile failed", false, target.name);
            return true;
        } finally {
            this.busy = false;
        }
    }

    async compile(): Promise<void> {
        if (this.busy) {
            toast("Compile already running", 1500);
            return;
        }
        const s = this.settings;
        const file = g.editorManager.activeFile;

        if (!file || !file.uri) return toast("No active file", 3000);
        if (!/\.(pwn|p|inc)$/i.test(file.name))
            return toast("Not a .pwn / .p / .inc file", 3000);

        // File .inc tidak bisa di-compile sendiri: pakai "main" dari .acode/task.json
        let target = { uri: file.uri as string, name: file.name as string };
        let mainNote = "";
        if (/\.inc$/i.test(file.name)) {
            if (s.autoSave && file.isUnsaved) {
                try {
                    await file.save(); // simpan dulu supaya perubahan include ikut ter-compile
                } catch {
                    /* lanjut saja */
                }
            }
            let reason = "";
            let main: { uri: string; name: string } | null = null;
            try {
                const plan = await findTask(file.uri);
                if (!plan) reason = "this project has no .acode/task.json";
                else if (!plan.main) reason = 'task.json has no "main" field';
                else {
                    main = await resolveMain(plan);
                    if (!main) reason = `main file not found: ${plan.main}`;
                    else
                        mainNote = `[task] main: ${plan.main} (from ${file.name})\n`;
                }
            } catch (e: any) {
                reason = String(e?.message ?? e);
            }
            if (!main) {
                const v = new OutputView("Pawn Compile");
                v.append(
                    `A .inc file cannot be compiled directly (${reason}).\n\n` +
                        'Add "main" to task.json, for example:\n  "main": "gamemodes/ECRP.pwn"\n'
                );
                v.finish("Compile failed", false, file.name);
                return;
            }
            target = main;
        }

        if (
            s.useWasm !== false &&
            (await this.compileWithWasm(file, target, s, mainNote))
        )
            return;

        if (typeof Executor === "undefined") {
            const v = new OutputView("Pawn Compile");
            v.append(
                "Executor not available. Update Acode to a version with terminal support."
            );
            v.finish("Compile failed", false);
            return;
        }

        const full = toShellPath(target.uri);
        if (!full) {
            const v = new OutputView("Pawn Compile");
            v.append(
                `Cannot map path:\n${target.uri}\n\nOpen the folder from local storage (file://), not SAF.`
            );
            v.finish("Compile failed", false);
            return;
        }

        this.busy = true;
        try {
            if (s.autoSave && file.isUnsaved) {
                try {
                    await file.save();
                } catch {
                    /* lanjut saja */
                }
            }

            if (!(await this.hasCompiler())) {
                const done = await this.setup(false);
                if (done !== "ok" || !(await this.hasCompiler())) {
                    toast("pawncc is not available", 3000);
                    return;
                }
            }

            const dir = full.slice(0, full.lastIndexOf("/"));
            const name = full.slice(full.lastIndexOf("/") + 1);
            const outName = name.replace(/\.[^.]+$/, ".amx");
            let incs = [
                dir,
                `${dir}/include`,
                `${dir}/../pawno/include`,
                `${dir}/../qawno/include`
            ];

            // Flag & include diambil dari .acode/task.json di project (bila ada)
            let note = "";
            let compiler = s.compilerPath;
            let argv: string[] | null = null;
            try {
                const plan = await findTask(target.uri);
                if (plan) {
                    const t = forShell(plan, {
                        file: full,
                        toShell: toShellPath
                    });
                    argv = t.args.some(a => !a.startsWith("-"))
                        ? t.args
                        : [name, ...t.args];
                    incs = [...t.includes, ...incs];
                    compiler = plan.command || compiler;
                    note = `[task] ${plan.label} ← .acode/task.json\n`;
                }
            } catch (e: any) {
                note = `[task] ${e?.message ?? e}; using plugin settings\n`;
            }
            if (!argv) {
                // Tiap flag di-quote: flag seperti -;+ dan -(+ berisi karakter spesial shell
                argv = [name, `-o${outName}`, ...flagsOf(s)];
            }
            incs = [...incs, ...extraIncludesOf(s)];
            const incFlags = incs.map(p => `-i${q(p)}`).join(" ");
            const cmd = `sh -c ${q(
                `cd ${q(dir)} && ${q(compiler)} ${argv.map(q).join(" ")} ` +
                    `${incFlags} 2>&1`
            )}`;

            const view = new OutputView("Compiling...");
            if (mainNote) view.append(mainNote);
            if (note) view.append(note);
            try {
                const { code } = await exec(
                    cmd,
                    !!s.useAlpine,
                    t => view.append(t),
                    120000
                );
                if (!view.buffer.trim()) view.append("(no output)");
                view.finish(
                    code === 0 ? "Compile succeeded" : "Compile failed",
                    code === 0,
                    name,
                    p =>
                        shellToUrl(p.startsWith("/") ? p : `${dir}/${p}`) ||
                        null
                );
            } catch (e: any) {
                view.append(`\nFailed to run command:\n${e?.message ?? e}`);
                view.finish("Compile failed", false, name);
            }
        } finally {
            this.busy = false;
        }
    }
}

if (window.acode) {
    const acodePlugin = new AcodePlugin();

    (acode as any).setPluginInit(
        plugin.id,
        async (
            baseUrl: string,
            $page: Acode.WCPage,
            { cacheFileUrl, cacheFile, firstInit, fileIcons }: any
        ) => {
            acodePlugin.fileIcons = fileIcons ?? null;
            acodePlugin.baseUrl = baseUrl.endsWith("/")
                ? baseUrl
                : `${baseUrl}/`;
            await acodePlugin.init($page, cacheFile, cacheFileUrl, !!firstInit);
        },
        acodePlugin.settingsObject
    );

    acode.setPluginUnmount(plugin.id, () => {
        acodePlugin.destroy().catch(() => {});
    });
}
