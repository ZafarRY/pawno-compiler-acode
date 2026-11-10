/* ------------------------------------------------------------------ */
/*  Engine pawncc.wasm untuk plugin Pawno Compiler (tanpa Alpine).      */
/*  Butuh 2 file di root plugin: pawncc-glue.js dan pawncc.wasm         */
/*  (lihat assets/ dan pack-zip.js).                                    */
/* ------------------------------------------------------------------ */

const g = window as any;

const MAX_DEPTH = 3; // kedalaman subfolder yang disalin
const MAX_FILES = 1500; // batas jumlah file
const MAX_BYTES = 40 * 1024 * 1024; // batas total ukuran
const SKIP_DIRS = new Set([
    "node_modules",
    "plugins",
    "scriptfiles",
    "npcmodes",
    "backup",
    "backups"
]);
const SRC_RE = /\.(pwn|inc|p|h)$/i;

/** Dilempar bila glue/wasm gagal dimuat -> pemanggil boleh jatuh ke Alpine. */
export class EngineLoadError extends Error {}

export interface WasmCompileOptions {
    baseUrl: string; // folder plugin (berakhiran "/")
    fileUrl: string; // URL Acode file .pwn aktif
    fileName: string;
    flags: string[]; // flag compiler, sudah dipecah per token
    extraIncludes: string[]; // path include tambahan dari pengaturan
    includeUrls?: string[]; // include dari task.json (sudah berupa URL Acode)
    taskArgs?: string[]; // argumen dari task.json (sudah di-expand untuk wasm); menggantikan flags
    onChunk: (text: string) => void;
}

export interface WasmCompileResult {
    code: number;
    outName: string;
    saved: boolean;
    fileCount: number;
    truncated: boolean;
    fileMap: Record<string, string>; // path virtual (/w/..., /i0/...) -> URL Acode asli
}

/* ----------------------------- util ------------------------------ */

export function fsop(url: string): any {
    return g.acode.require("fsOperation")(url);
}

export function urlDirname(u: string): string {
    try {
        const U = g.acode.require("url");
        if (U && typeof U.dirname === "function") return U.dirname(u);
    } catch {
        /* pakai cara manual */
    }
    const i = u.lastIndexOf("/");
    return i > 0 ? u.slice(0, i) : u;
}

export function urlJoin(base: string, ...parts: string[]): string {
    try {
        const U = g.acode.require("url");
        if (U && typeof U.join === "function") return U.join(base, ...parts);
    } catch {
        /* pakai cara manual */
    }
    return [base.replace(/\/+$/, ""), ...parts].join("/");
}

/** Path ala shell (/sdcard/...) -> URL Acode. Mengembalikan "" bila tidak dikenali. */
export function shellToUrl(p: string): string {
    const s = p.trim();
    if (/^(file|content):\/\//.test(s)) return s;
    const m = s.match(/^\/(?:sdcard|storage\/emulated\/\d+)\/(.*)$/);
    if (m) return `file:///storage/emulated/0/${m[1]}`;
    return "";
}

export async function existsUrl(u: string): Promise<boolean> {
    try {
        return !!(await (await fsop(u)).exists());
    } catch {
        return false;
    }
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.arrayBuffer();
    } catch (e) {
        // cadangan: XHR (beberapa WebView menolak fetch untuk URL lokal)
        return await new Promise<ArrayBuffer>((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open("GET", url, true);
            x.responseType = "arraybuffer";
            x.onload = () =>
                x.status === 200 || (x.status === 0 && x.response)
                    ? resolve(x.response)
                    : reject(new Error(`HTTP ${x.status}`));
            x.onerror = () =>
                reject(e instanceof Error ? e : new Error("failed to load"));
            x.send();
        });
    }
}

function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`failed to load ${src}`));
        document.head.appendChild(s);
    });
}

/* ----------------------------- engine ---------------------------- */

let enginePromise: Promise<WebAssembly.Module> | null = null;

function loadEngine(baseUrl: string): Promise<WebAssembly.Module> {
    if (enginePromise) return enginePromise;
    const p = (async () => {
        try {
            if (typeof g.PawnCompiler !== "function")
                await loadScript(`${baseUrl}pawncc-glue.js`);
            if (typeof g.PawnCompiler !== "function")
                throw new Error("PawnCompiler is not defined");
            const bytes = await fetchBytes(`${baseUrl}pawncc.wasm`);
            return await WebAssembly.compile(bytes);
        } catch (e: any) {
            throw new EngineLoadError(String(e?.message ?? e));
        }
    })();
    p.catch(() => {
        if (enginePromise === p) enginePromise = null;
    });
    enginePromise = p;
    return p;
}

/* --------------------------- kumpulkan file ----------------------- */

interface Item {
    vpath: string;
    url: string;
}
interface Budget {
    files: number;
    truncated: boolean;
}

async function collect(
    dirUrl: string,
    vroot: string,
    depth: number,
    items: Item[],
    budget: Budget
): Promise<void> {
    let entries: any[];
    try {
        entries = await (await fsop(dirUrl)).lsDir();
    } catch {
        return;
    }
    for (const e of entries) {
        if (budget.files >= MAX_FILES) {
            budget.truncated = true;
            return;
        }
        const name = String(e?.name ?? "");
        if (!name || name.startsWith(".")) continue;
        if (e.isDirectory) {
            if (depth < MAX_DEPTH && !SKIP_DIRS.has(name.toLowerCase())) {
                await collect(
                    e.url,
                    `${vroot}/${name}`,
                    depth + 1,
                    items,
                    budget
                );
            }
        } else if (SRC_RE.test(name)) {
            items.push({ vpath: `${vroot}/${name}`, url: e.url });
            budget.files++;
        }
    }
}

async function saveBinary(
    dirUrl: string,
    name: string,
    bytes: Uint8Array
): Promise<boolean> {
    const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    );
    try {
        const target = urlJoin(dirUrl, name);
        const f = await fsop(target);
        if (await f.exists()) {
            await f.writeFile(buf);
            return true;
        }
    } catch {
        /* coba buat baru */
    }
    try {
        const dir = await fsop(dirUrl);
        const created = await dir.createFile(name, "");
        await (await fsop(created)).writeFile(buf);
        return true;
    } catch {
        return false;
    }
}

/* ------------------------------ compile --------------------------- */

export async function compileWasm(
    o: WasmCompileOptions
): Promise<WasmCompileResult> {
    const wasmModule = await loadEngine(o.baseUrl);

    const srcDir = urlDirname(o.fileUrl);
    const items: Item[] = [];
    const budget: Budget = { files: 0, truncated: false };

    // 1) folder source (rekursif terbatas) -> /w
    await collect(srcDir, "/w", 0, items, budget);

    // 2) folder include tambahan -> /i0, /i1, ...
    const parent = urlDirname(srcDir);
    const cands = [
        ...(o.includeUrls ?? []),
        urlJoin(parent, "pawno", "include"),
        urlJoin(parent, "qawno", "include"),
        ...o.extraIncludes.map(shellToUrl).filter(Boolean)
    ];
    const incFlags = ["-i/w", "-i/w/include"];
    let idx = 0;
    for (const c of cands) {
        if (!(await existsUrl(c))) continue;
        const v = `/i${idx++}`;
        await collect(c, v, 0, items, budget);
        incFlags.push(`-i${v}`);
    }

    // 3) baca semua file (biner, supaya encoding Windows-1252 tidak rusak)
    const loaded: Array<{ vpath: string; bytes: Uint8Array }> = [];
    let total = 0;
    const queue = items.slice();
    await Promise.all(
        Array.from({ length: 12 }, async () => {
            while (queue.length) {
                const it = queue.shift()!;
                try {
                    const raw = await (await fsop(it.url)).readFile();
                    const bytes =
                        typeof raw === "string"
                            ? new TextEncoder().encode(raw)
                            : new Uint8Array(raw as ArrayBuffer);
                    total += bytes.length;
                    if (total > MAX_BYTES) {
                        budget.truncated = true;
                        return;
                    }
                    loaded.push({ vpath: it.vpath, bytes });
                } catch {
                    /* lewati file yang tidak terbaca */
                }
            }
        })
    );

    // 4) buat instance baru per compile (state compiler bersih)
    const push = (t: string) => o.onChunk(`${t}\n`);
    const M = await g.PawnCompiler({
        noInitialRun: true,
        print: push,
        printErr: push,
        instantiateWasm: (info: any, cb: (i: WebAssembly.Instance) => void) => {
            WebAssembly.instantiate(wasmModule, info).then(cb as any);
            return {};
        }
    });

    const FS = M.FS;
    FS.mkdirTree("/w");
    for (const f of loaded) {
        FS.mkdirTree(f.vpath.slice(0, f.vpath.lastIndexOf("/")));
        FS.writeFile(f.vpath, f.bytes);
    }
    FS.chdir("/w");

    let outName = `${o.fileName.replace(/\.[^.]+$/, "")}.amx`;
    let args: string[];
    if (o.taskArgs) {
        const t = o.taskArgs.slice();
        const oi = t.findIndex(a => a.startsWith("-o"));
        if (oi >= 0) {
            outName = t[oi].slice(2).split(/[\\/]/).pop() || outName; // simpan di folder source
            t[oi] = `-o${outName}`;
        } else {
            t.push(`-o${outName}`);
        }
        if (!t.some(a => !a.startsWith("-"))) t.unshift(o.fileName);
        args = [...t, ...incFlags];
    } else {
        args = [o.fileName, `-o${outName}`, ...incFlags, ...o.flags];
    }

    let code = -1;
    try {
        code = M.callMain(args);
    } catch (e: any) {
        o.onChunk(
            `\n[wasm] compiler berhenti tak terduga: ${e?.message ?? e}\n`
        );
    }

    // 5) simpan .amx hanya kalau sukses (pawncc tetap membuat file kosong saat gagal)
    let saved = false;
    if (code === 0) {
        try {
            const amx: Uint8Array = FS.readFile(`/w/${outName}`);
            if (amx.length > 0) saved = await saveBinary(srcDir, outName, amx);
        } catch {
            /* abaikan */
        }
    }

    const fileMap: Record<string, string> = {};
    for (const it of items) fileMap[it.vpath] = it.url;
    return {
        code,
        outName,
        saved,
        fileCount: loaded.length,
        truncated: budget.truncated,
        fileMap
    };
}
