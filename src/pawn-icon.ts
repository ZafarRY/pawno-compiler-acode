/**
 * src/pawn-icon.ts - ikon pion untuk file .pwn di tab dan sidebar Acode.
 *
 * Jalur utama: File Icons API resmi Acode (acode.require("fileIcons"), versi 1012+).
 *   Pack didaftarkan oleh plugin; pengguna memilihnya sekali di
 *   Pengaturan -> App settings -> Icon pack -> "Pawno Compiler".
 *   Gambar: icons/pawn.png di dalam plugin (assets/icons/pawn.png di repo).
 * Jalur cadangan (Acode lama / belum memilih pack): ikon ditimpa lewat DOM.
 *
 * Cara kerja jalur cadangan (tidak bergantung pada struktur DOM tertentu):
 *  1) cari elemen "daun" yang teksnya berakhiran .pwn (label nama file),
 *  2) naik ke baris induknya, cari elemen ikon (class icon / file / file_type_*),
 *  3) ganti gambarnya lewat style inline !important + sembunyikan ::before bawaan.
 */

const ICON_FILE_RE = /\.pwn$/i; // mau .inc juga: /\.(pwn|inc)$/i
const ICON_CLASS = "pwn-file-icon";
const STYLE_ID = "pwn-icon-style";
const ICON_DATA =
    "data:image/png;base64,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";

const CSS = `
.${ICON_CLASS}::before,
.${ICON_CLASS}::after { content: none !important; display: none !important; }
`;

const LABEL_SEL = "span, div, p, a, li, label, b";
const painted = new Set<HTMLElement>();

function cls(e: Element): string {
    const c = (e as any).className;
    return typeof c === "string" ? c : (c?.baseVal ?? "");
}

/** Tombol bawaan header Acode (hamburger, menu, run, edit): jangan pernah diganti ikon pion. */
function isHeaderChrome(e: HTMLElement): boolean {
    if (e.hasAttribute("action") || e.closest("[action]")) return true;
    if (e.parentElement?.tagName === "HEADER") return true;
    return /(^|\s)(menu|more_vert|play_arrow|edit|create|search|undo|redo|save)(\s|$)/.test(
        cls(e)
    );
}

function isIcon(e: HTMLElement): boolean {
    if (isHeaderChrome(e)) return false;
    const c = cls(e);
    if (/clear|close|more|chevron|arrow|expand|folder/i.test(c)) return false;
    return /(^|\s)(icon|file|file_type_\S*)(\s|$)/.test(c);
}

function findLabels(): HTMLElement[] {
    const out: HTMLElement[] = [];
    document.body.querySelectorAll<HTMLElement>(LABEL_SEL).forEach(e => {
        if (
            e.childElementCount === 0 &&
            ICON_FILE_RE.test((e.textContent ?? "").trim())
        )
            out.push(e);
    });
    return out;
}

function findIcon(label: HTMLElement): HTMLElement | null {
    let row: HTMLElement | null = label;
    for (let i = 0; i < 3 && row; i++) {
        row = row.parentElement;
        if (!row) break;
        const found = Array.from(row.querySelectorAll<HTMLElement>("*")).filter(
            e => e !== label && !e.contains(label) && isIcon(e)
        );
        if (found.length)
            return found.find(e => /(^|\s)file(\s|_)/.test(cls(e))) ?? found[0];
    }
    return null;
}

function style(icon: HTMLElement, on: boolean): void {
    const st = icon.style;
    if (on) {
        icon.classList.add(ICON_CLASS);
        st.setProperty("background-image", `url("${ICON_DATA}")`, "important");
        st.setProperty("background-size", "100%", "important");
        st.setProperty("background-position", "center", "important");
        st.setProperty("background-repeat", "no-repeat", "important");
        st.setProperty("color", "transparent", "important");
        st.setProperty("font-size", "0", "important");
    } else {
        icon.classList.remove(ICON_CLASS);
        for (const p of [
            "background-image",
            "background-size",
            "background-position",
            "background-repeat",
            "color",
            "font-size"
        ])
            st.removeProperty(p);
    }
}

function paint(): void {
    const now = new Set<HTMLElement>();
    for (const label of findLabels()) {
        const icon = findIcon(label);
        if (icon) now.add(icon);
    }
    for (const icon of painted) if (!now.has(icon)) style(icon, false);
    // sisa ikon yang pernah dicat tapi tidak lagi dilacak (mis. hamburger header): kembalikan
    document.querySelectorAll<HTMLElement>(`.${ICON_CLASS}`).forEach(i => {
        if (!now.has(i)) style(i, false);
    });
    for (const icon of now) style(icon, true);
    painted.clear();
    now.forEach(i => painted.add(i));
}

/** Teks diagnosa (struktur tab/sidebar untuk file .pwn), untuk dikirim balik bila ikon belum berubah. */
export function describePawnRows(): string {
    const labels = findLabels();
    if (!labels.length)
        return "No element labelled *.pwn on screen (open a .pwn file first, and open the sidebar).";
    return labels
        .slice(0, 4)
        .map((l, i) => {
            const icon = findIcon(l);
            const row = l.parentElement?.parentElement ?? l.parentElement ?? l;
            return (
                `#${i} label: <${l.tagName.toLowerCase()} class="${cls(l)}">${(l.textContent ?? "").trim()}\n` +
                `   icon found: ${icon ? `<${icon.tagName.toLowerCase()} class="${cls(icon)}">` : "NO"}\n` +
                `   row: ${row.outerHTML.replace(/data:image[^"')]+/g, "data:...").slice(0, 700)}`
            );
        })
        .join("\n\n");
}

/** Pasang ikon .pwn. Mengembalikan fungsi untuk melepas (dipanggil di destroy). */
export function registerPawnIcon(): () => void {
    if (!document.getElementById(STYLE_ID)) {
        const st = document.createElement("style");
        st.id = STYLE_ID;
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    paint();
    setTimeout(paint, 800);
    setTimeout(paint, 2500); // tab yang dipulihkan saat Acode dibuka

    let queued = false;
    const obs = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            paint();
        });
    });
    obs.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });

    return () => {
        obs.disconnect();
        document.getElementById(STYLE_ID)?.remove();
        painted.forEach(i => style(i, false));
        painted.clear();
    };
}

export interface InstallResult {
    undo: () => void;
    /** true bila File Icons API resmi tersedia dan pack berhasil didaftarkan */
    packRegistered: boolean;
}

/** Pasang ikon .pwn: daftar icon pack resmi (bila ada) + cadangan DOM. */
export function installPawnIcon(o: {
    fileIcons?: any;
    baseUrl: string;
    id: string;
}): InstallResult {
    let reg: { dispose?: () => void } | null = null;
    const fi = o.fileIcons;
    if (fi && typeof fi.register === "function") {
        try {
            reg = fi.register({
                id: o.id,
                name: "Pawno Compiler",
                icons: { pawn: { src: `${o.baseUrl}icons/pawn.png` } },
                fileExtensions: { pwn: "pawn" }
            });
        } catch (e) {
            console.warn("Pawno: failed to register icon pack", e);
        }
    }
    const undoDom = registerPawnIcon();
    return {
        packRegistered: !!reg,
        undo: () => {
            undoDom();
            try {
                reg?.dispose?.();
            } catch {
                /* abaikan */
            }
        }
    };
}
