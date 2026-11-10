/* ------------------------------------------------------------------ */
/*  Baca .acode/task.json di folder project (gaya VS Code tasks).       */
/*                                                                      */
/*  {                                                                   */
/*    "version": "1.0",                                                 */
/*    "tasks": [{                                                       */
/*      "label": "build",                                               */
/*      "args": ["${file}", "-D${fileDirname}", "-;+", "-(+", "-d3"],   */
/*      "includes": ["${workspaceRoot}/qawno/include"],                 */
/*      "group": { "kind": "build", "isDefault": true }                 */
/*    }]                                                                */
/*  }                                                                   */
/*                                                                      */
/*  Variabel: ${file} ${fileDirname} ${fileBasename}                    */
/*  ${fileBasenameNoExtension} ${fileExtname} ${relativeFile}           */
/*  ${workspaceRoot} (alias ${workspaceFolder})                         */
/* ------------------------------------------------------------------ */

import { existsUrl, fsop, shellToUrl, urlDirname, urlJoin } from "./wasm";

export interface TaskPlan {
    label: string;
    rootUrl: string; // folder yang berisi .acode/
    fileDirUrl: string; // folder file .pwn aktif
    args: string[]; // mentah (belum di-expand)
    includes: string[]; // mentah
    command?: string; // opsional: path compiler (jalur Alpine)
    main?: string; // file utama (mentah), dipakai saat file aktif adalah .inc
}

const MAX_UP = 8; // naik maksimal 8 folder mencari .acode/task.json

/** Buang komentar (// dan block) serta trailing comma, supaya JSONC pun terbaca. */
function stripJsonc(src: string): string {
    let out = "";
    let i = 0;
    let inStr = false;
    while (i < src.length) {
        const c = src[i];
        const n = src[i + 1];
        if (inStr) {
            out += c;
            if (c === "\\") {
                out += n ?? "";
                i += 2;
                continue;
            }
            if (c === '"') inStr = false;
            i++;
            continue;
        }
        if (c === '"') {
            inStr = true;
            out += c;
            i++;
        } else if (c === "/" && n === "/") {
            while (i < src.length && src[i] !== "\n") i++;
        } else if (c === "/" && n === "*") {
            i += 2;
            while (i < src.length && !(src[i] === "*" && src[i + 1] === "/"))
                i++;
            i += 2;
        } else {
            out += c;
            i++;
        }
    }
    return out.replace(/,(\s*[}\]])/g, "$1");
}

async function readText(url: string): Promise<string> {
    const raw = await (await fsop(url)).readFile("utf8");
    const text =
        typeof raw === "string"
            ? raw
            : new TextDecoder().decode(new Uint8Array(raw as ArrayBuffer));
    return text.replace(/^﻿/, "");
}

const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : [];

/** Cari task.json dari folder file naik ke atas. null = tidak ada. Lempar Error bila isinya tidak valid. */
export async function findTask(fileUrl: string): Promise<TaskPlan | null> {
    const fileDir = urlDirname(fileUrl);

    // 1) folder yang dibuka di Acode dan memuat file ini (paling spesifik dulu), 2) naik dari folder file
    const roots: string[] = [];
    try {
        for (const f of (window as any).addedFolder ?? []) {
            const u = String(f?.url ?? "");
            if (u && fileUrl.startsWith(u)) roots.push(u);
        }
    } catch {
        /* abaikan */
    }
    roots.sort((a, b) => b.length - a.length);
    let d = fileDir;
    for (let i = 0; i <= MAX_UP; i++) {
        roots.push(d);
        const up = urlDirname(d);
        if (!up || up === d) break;
        d = up;
    }

    const seen = new Set<string>();
    for (const root of roots) {
        if (seen.has(root)) continue;
        seen.add(root);
        const taskUrl = urlJoin(root, ".acode", "task.json");
        if (!(await existsUrl(taskUrl))) continue;

        let json: any;
        try {
            json = JSON.parse(stripJsonc(await readText(taskUrl)));
        } catch (e: any) {
            throw new Error(`.acode/task.json is invalid (${e?.message ?? e})`);
        }
        const tasks: any[] = Array.isArray(json?.tasks) ? json.tasks : [];
        const isBuild = (t: any) =>
            t?.group === "build" || t?.group?.kind === "build";
        const t =
            tasks.find(x => isBuild(x) && x?.group?.isDefault) ??
            tasks.find(isBuild) ??
            tasks[0];
        if (!t) throw new Error(".acode/task.json has no task");

        return {
            label: String(t.label ?? "build"),
            rootUrl: root,
            fileDirUrl: fileDir,
            args: asStrings(t.args),
            includes: asStrings(t.includes),
            command: t.command ? String(t.command) : undefined,
            main: t.main ? String(t.main) : undefined
        };
    }
    return null;
}

/* ----------------------------- variabel ---------------------------- */

const VAR_RE = /\$\{(\w+)\}/g;
const hasVar = (s: string) => /\$\{\w+\}/.test(s);
const expand = (s: string, vars: Record<string, string>) =>
    s.replace(VAR_RE, (m, k: string) => (k in vars ? vars[k] : m));

function baseVars(base: string): Record<string, string> {
    const dot = base.lastIndexOf(".");
    return {
        fileBasename: base,
        fileBasenameNoExtension: dot > 0 ? base.slice(0, dot) : base,
        fileExtname: dot > 0 ? base.slice(dot) : ""
    };
}

/** Untuk jalur Alpine: semua variabel menjadi path shell (/sdcard/...). */
export function forShell(
    plan: TaskPlan,
    c: { file: string; toShell: (url: string) => string | null }
): { args: string[]; includes: string[] } {
    const i = c.file.lastIndexOf("/");
    const dir = c.file.slice(0, i);
    const base = c.file.slice(i + 1);
    const root = c.toShell(plan.rootUrl);

    const vars: Record<string, string> = {
        ...baseVars(base),
        file: c.file,
        fileDirname: dir,
        relativeFile:
            root && c.file.startsWith(`${root}/`)
                ? c.file.slice(root.length + 1)
                : base
    };
    if (root) {
        vars.workspaceRoot = root;
        vars.workspaceFolder = root;
    }

    const args = plan.args.map(a => expand(a, vars));
    const includes = plan.includes.map(a => expand(a, vars));
    const bad = [...args, ...includes].find(hasVar);
    if (bad)
        throw new Error(`variable cannot be mapped to a shell path: ${bad}`);
    return { args, includes };
}

/** Satu include (mentah) -> URL Acode. "" bila tidak bisa dipetakan. */
function includeToUrl(plan: TaskPlan, raw: string): string {
    const m = raw.match(
        /^\$\{(workspaceRoot|workspaceFolder|fileDirname)\}(.*)$/
    );
    if (m) {
        const base = m[1] === "fileDirname" ? plan.fileDirUrl : plan.rootUrl;
        const parts = m[2].split("/").filter(Boolean);
        return parts.length ? urlJoin(base, ...parts) : base;
    }
    if (hasVar(raw)) return "";
    const direct = shellToUrl(raw);
    if (direct) return direct;
    if (!raw.startsWith("/") && !/^\w+:\/\//.test(raw)) {
        // path relatif -> relatif ke root project
        return urlJoin(plan.rootUrl, ...raw.split("/").filter(Boolean));
    }
    return "";
}

/** File utama dari task ("main"), bila ada dan benar-benar ada di disk. */
export async function resolveMain(
    plan: TaskPlan
): Promise<{ uri: string; name: string } | null> {
    if (!plan.main) return null;
    const uri = includeToUrl(plan, plan.main);
    if (!uri || !(await existsUrl(uri))) return null;
    return { uri, name: plan.main.split(/[\\/]/).pop() || plan.main };
}

/**
 * Untuk jalur WASM: compiler berjalan di filesystem virtual (cwd = /w), jadi
 *  - ${file} -> nama file, -D... dibuang, -i... & "includes" -> URL yang disalin ke FS virtual.
 */
export function forWasm(
    plan: TaskPlan,
    fileName: string
): { args: string[]; includeUrls: string[]; skipped: string[] } {
    const vars: Record<string, string> = {
        ...baseVars(fileName),
        file: fileName,
        relativeFile: fileName,
        fileDirname: "/w",
        workspaceRoot: "/w",
        workspaceFolder: "/w"
    };
    const args: string[] = [];
    const includeUrls: string[] = [];
    const skipped: string[] = [];

    const addInclude = (raw: string) => {
        const u = includeToUrl(plan, raw);
        if (u) includeUrls.push(u);
        else skipped.push(raw);
    };

    for (const a of plan.args) {
        if (a.startsWith("-i") && a.length > 2) addInclude(a.slice(2));
        else if (a.startsWith("-D")) continue;
        else args.push(expand(a, vars));
    }
    for (const inc of plan.includes) addInclude(inc);
    return { args, includeUrls, skipped };
}
