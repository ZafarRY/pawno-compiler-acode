/* ------------------------------------------------------------------ */
/*  Syntax highlighting Pawn (.pwn / .inc) untuk Acode (CodeMirror 6)   */
/*  + tema "Pawno Night". Didaftarkan lewat editorLanguages/editorThemes */
/* ------------------------------------------------------------------ */

const g = window as any;

export const LANG_ID = "pawn";
export const THEME_ID = "pawno-night";
export const PAWN_FILE_RE = /\.(pwn|inc)$/i;

const KEYWORDS = new Set([
    "assert",
    "break",
    "case",
    "continue",
    "default",
    "do",
    "else",
    "exit",
    "for",
    "goto",
    "if",
    "return",
    "sizeof",
    "sleep",
    "state",
    "switch",
    "tagof",
    "while",
    "defined",
    "char",
    "operator",
    "foreach",
    "forward",
    "native",
    "public",
    "stock",
    "static",
    "new",
    "const",
    "enum",
    "cellof"
]);
/** Setelah kata kunci ini, identifier berikutnya adalah nama yang didefinisikan. */
const DEF_KEYWORDS = new Set([
    "new",
    "static",
    "const",
    "stock",
    "public",
    "forward",
    "native",
    "enum"
]);
const BOOLS = new Set([
    "true",
    "false",
    "cellmax",
    "cellmin",
    "cellbits",
    "charbits",
    "charmax",
    "charmin",
    "ucharmax",
    "__Pawn",
    "__DATE__",
    "__TIME__"
]);

const CALLBACK_RE = /^On[A-Z]\w*$/; // OnPlayerConnect, OnGameModeInit, ...
const CONST_RE = /^[A-Z][A-Z0-9_]{1,}$/; // MAX_PLAYERS, DIALOG_STYLE_LIST, ...

interface PawnState {
    inComment: boolean; // di dalam /* ... */
    str: string | null; // karakter pembuka string yang sedang berjalan
    atLineStart: boolean; // belum ada token selain spasi di baris ini
    incl: boolean; // setelah #include
    macro: boolean; // setelah #define / #undef
    expectDef: boolean; // setelah new/stock/public/...
}

/** Parser token untuk StreamLanguage (nama token = nama tag CodeMirror). */
export const pawnParser = {
    name: "pawn",

    startState(): PawnState {
        return {
            inComment: false,
            str: null,
            atLineStart: true,
            incl: false,
            macro: false,
            expectDef: false
        };
    },

    copyState(s: PawnState): PawnState {
        return { ...s };
    },

    token(stream: any, state: PawnState): string | null {
        if (stream.sol()) {
            state.atLineStart = true;
            state.incl = false;
            state.macro = false;
            if (!state.inComment) state.str = null;
        }
        const r = pawnToken(stream, state);
        if (r !== null) state.atLineStart = false;
        return r;
    },

    languageData: {
        commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
        closeBrackets: { brackets: ["(", "[", "{", "'", '"'] }
    }
};

function readString(stream: any, state: PawnState): string {
    const q = state.str as string;
    const c = stream.peek();
    if (c === "\\") {
        stream.next();
        stream.next();
        return "escape";
    }
    if (c === "%") {
        if (stream.match(/^%[-+0 #]*[0-9*]*(?:\.[0-9*]+)?[a-zA-Z%]/))
            return "string.special"; // %d %s %.2f %%
        stream.next();
        return "string";
    }
    if (c === "{" && stream.match(/^\{[0-9a-fA-F]{6}\}/)) return "atom"; // warna inline {FFFFFF}
    if (c === q) {
        stream.next();
        state.str = null;
        return "string";
    }
    let n = 0;
    while (!stream.eol()) {
        const ch = stream.peek();
        if (ch === "\\" || ch === "%" || ch === "{" || ch === q) break;
        stream.next();
        n++;
    }
    if (n === 0) stream.next();
    return "string";
}

function pawnToken(stream: any, state: PawnState): string | null {
    if (state.inComment) {
        if (stream.skipTo("*/")) {
            stream.match("*/");
            state.inComment = false;
        } else {
            stream.skipToEnd();
        }
        return "comment";
    }
    if (state.str) return readString(stream, state);
    if (stream.eatSpace()) return null;

    const keepDef = state.expectDef;
    state.expectDef = false;

    // komentar
    if (stream.match("//")) {
        stream.skipToEnd();
        return "comment";
    }
    if (stream.match("/*")) {
        if (stream.skipTo("*/")) stream.match("*/");
        else {
            stream.skipToEnd();
            state.inComment = true;
        }
        return "comment";
    }

    // preprocessor: #include, #define, #if, #pragma, ...
    if (state.atLineStart && stream.match(/^#\s*\w+/)) {
        const d = stream.current().replace(/#\s*/, "");
        state.incl = d === "include" || d === "tryinclude";
        state.macro = d === "define" || d === "undef";
        return "meta";
    }
    if (state.incl && stream.match(/^<[^>\n]*>?/)) {
        state.incl = false;
        return "string";
    }

    // string / karakter
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
        stream.next();
        state.str = ch;
        return "string";
    }

    // angka: 0xFF, 0b101, 12, 1.5e3
    if (
        stream.match(/^0[xX][0-9a-fA-F_]+/) ||
        stream.match(/^0[bB][01_]+/) ||
        stream.match(/^\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    ) {
        return "number";
    }

    // identifier / kata kunci
    if (stream.match(/^[A-Za-z_@][\w@]*/)) {
        const w: string = stream.current();

        // tag: Float:x  bool:y  _:z  (":" menempel langsung, diikuti huruf)
        if (stream.match(/^:(?=[A-Za-z_@])/)) {
            state.expectDef = keepDef;
            return "typeName";
        }
        if (state.macro) {
            state.macro = false;
            return "atom";
        }
        if (KEYWORDS.has(w)) {
            state.expectDef = DEF_KEYWORDS.has(w);
            return "keyword";
        }
        if (BOOLS.has(w)) return "bool";
        if (CALLBACK_RE.test(w)) return "variableName.special";
        if (keepDef) return "variableName.definition";
        if (CONST_RE.test(w)) return "atom";
        if (stream.match(/^\s*\(/, false)) return "variableName.function";
        return "variableName";
    }

    if (stream.match(/^(?:\.\.\.?|[-+*/%&|^~<>=!?]+)/)) return "operator";
    if (stream.match(/^[()[\]{}]/)) return "bracket";
    if (stream.match(/^[;,:.]/)) return "punctuation";

    stream.next();
    return null;
}

/* ------------------------------ pendaftaran ------------------------------ */

function cmModules(): { language: any } | null {
    try {
        const cm = g.acode.require("codemirror");
        if (cm?.language) return cm;
    } catch {
        /* coba nama paket langsung */
    }
    try {
        const language = g.acode.require("@codemirror/language");
        if (language) return { language };
    } catch {
        /* tidak tersedia */
    }
    return null;
}

/** Daftarkan bahasa Pawn. Mengembalikan fungsi pembatal, atau null bila Acode tidak mendukung. */
export function registerPawnLanguage(
    completion?: (ctx: any) => any
): (() => void) | null {
    let langs: any;
    try {
        langs = g.acode.require("editorLanguages");
    } catch {
        return null;
    }
    if (!langs || typeof langs.register !== "function") return null;

    langs.register(
        LANG_ID,
        ["pwn", "inc"],
        "Pawn",
        () => {
            const cm = cmModules();
            if (!cm) throw new Error("CodeMirror module not available");
            const { StreamLanguage, LanguageSupport } = cm.language;
            const lang = StreamLanguage.define(pawnParser);
            // sumber autocomplete lewat language data (standar CodeMirror 6)
            const extra = completion
                ? [lang.data.of({ autocomplete: completion })]
                : [];
            return new LanguageSupport(lang, extra);
        },
        {
            aliases: ["pawno", "samp", "sa-mp"],
            filenameMatchers: [PAWN_FILE_RE]
        }
    );

    return () => {
        try {
            langs.unregister(LANG_ID);
        } catch {
            /* abaikan */
        }
    };
}

/** File .pwn/.inc yang sudah terbuka sebelum plugin dimuat ikut diwarnai. */
export function applyToOpenFiles(): void {
    try {
        for (const f of g.editorManager.files ?? []) {
            if (
                PAWN_FILE_RE.test(f?.name ?? "") &&
                typeof f.setMode === "function"
            )
                f.setMode(LANG_ID);
        }
    } catch {
        /* abaikan */
    }
}

/* --------------------------------- tema --------------------------------- */

export const THEME_COLORS = {
    bg: "#11151c",
    fg: "#d6deeb",
    gutterBg: "#0d1117",
    gutterFg: "#5c6773",
    keyword: "#c792ea",
    type: "#ffcb6b",
    bool: "#ff5370",
    atom: "#ffd580",
    number: "#f78c6c",
    meta: "#89ddff",
    string: "#c3e88d",
    special: "#89ddff",
    comment: "#637777",
    func: "#82aaff",
    def: "#7dd3fc",
    callback: "#ff7eb6",
    operator: "#89ddff",
    punct: "#8aa0b8",
    bracket: "#a6b8cc"
};

export function registerPawnTheme(): (() => void) | null {
    let et: any;
    try {
        et = g.acode.require("editorThemes");
    } catch {
        return null;
    }
    if (!et || typeof et.register !== "function") return null;

    const C = THEME_COLORS;
    const t = et.cm.tags;
    const highlightStyle = et.createHighlightStyle([
        { tag: t.keyword, color: C.keyword },
        { tag: t.typeName, color: C.type },
        { tag: t.bool, color: C.bool },
        { tag: t.atom, color: C.atom },
        { tag: t.number, color: C.number },
        { tag: t.meta, color: C.meta },
        { tag: t.string, color: C.string },
        { tag: t.special(t.string), color: C.special },
        { tag: t.escape, color: C.special },
        { tag: t.comment, color: C.comment, fontStyle: "italic" },
        { tag: t.function(t.variableName), color: C.func },
        { tag: t.definition(t.variableName), color: C.def },
        { tag: t.special(t.variableName), color: C.callback },
        { tag: t.operator, color: C.operator },
        { tag: t.punctuation, color: C.punct },
        { tag: t.bracket, color: C.bracket },
        { tag: t.variableName, color: C.fg }
    ]);

    et.register({
        id: THEME_ID,
        caption: "Pawno Night",
        dark: true,
        extensions: et.createTheme({
            dark: true,
            highlightStyle,
            styles: {
                "&": { color: C.fg, backgroundColor: C.bg },
                ".cm-content": { caretColor: "#7dd3fc" },
                ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#7dd3fc" },
                ".cm-gutters": {
                    backgroundColor: C.gutterBg,
                    color: C.gutterFg,
                    border: "none"
                },
                ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.04)" },
                ".cm-activeLineGutter": {
                    backgroundColor: "rgba(255,255,255,.06)",
                    color: "#a6b8cc"
                },
                "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
                    {
                        backgroundColor: "rgba(96,165,250,.28)"
                    }
            }
        })
    });

    return () => {
        try {
            et.unregister(THEME_ID);
        } catch {
            /* abaikan */
        }
    };
}

export function applyPawnTheme(): boolean {
    try {
        g.acode.require("editorThemes").apply(THEME_ID);
        return true;
    } catch {
        return false;
    }
}
