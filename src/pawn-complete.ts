/* ------------------------------------------------------------------ */
/*  Autocomplete + snippet Pawn (SA-MP / open.mp) untuk Acode (CM6)      */
/*  Sumber saran:                                                        */
/*   1) bawaan: callback, native, konstanta, kata kunci, snippet         */
/*   2) file yang sedang dibuka (fungsi, #define, new, enum)             */
/*   3) file .inc project (pawno/include, qawno/include, task.json, ...) */
/*   4) modul .pwn/.inc di folder gamemode(s) (rekursif, nama bebas)     */
/*  Didaftarkan lewat language data "autocomplete" pada bahasa Pawn.     */
/* ------------------------------------------------------------------ */

import { findTask, forWasm } from "./task";
import { fsop, urlDirname, urlJoin } from "./wasm";

const g = window as any;
const FILE_RE = /\.(pwn|inc|p)$/i;
const INC_RE = /\.inc$/i;
const SRC_RE = /\.(inc|pwn)$/i;
const SKIP_DIRS = new Set([
    "node_modules",
    "plugins",
    "scriptfiles",
    "npcmodes",
    "backup",
    "backups"
]);
const GAMEMODE_DIR_RE = /^gamemodes?$/i;
const CMD_TAG_RE = /^(?:Y?CMD|ACMD|ZCMD|DCMD|PCMD|COMMAND|ALT|ALTCOMMAND)$/i;
const NOT_FN = new Set([
    "if",
    "for",
    "while",
    "switch",
    "foreach",
    "return",
    "else",
    "do",
    "case",
    "sizeof",
    "defined",
    "tagof",
    "assert",
    "goto",
    "state",
    "catch"
]);

/* ------------------------------- data ------------------------------- */

/** Callback SA-MP: nama(params) */
const CALLBACKS = `
OnGameModeInit()
OnGameModeExit()
OnFilterScriptInit()
OnFilterScriptExit()
OnPlayerConnect(playerid)
OnPlayerDisconnect(playerid, reason)
OnPlayerSpawn(playerid)
OnPlayerDeath(playerid, killerid, reason)
OnPlayerRequestClass(playerid, classid)
OnPlayerRequestSpawn(playerid)
OnPlayerText(playerid, text[])
OnPlayerCommandText(playerid, cmdtext[])
OnPlayerUpdate(playerid)
OnPlayerStateChange(playerid, newstate, oldstate)
OnPlayerKeyStateChange(playerid, newkeys, oldkeys)
OnPlayerInteriorChange(playerid, newinteriorid, oldinteriorid)
OnPlayerEnterVehicle(playerid, vehicleid, ispassenger)
OnPlayerExitVehicle(playerid, vehicleid)
OnPlayerEnterCheckpoint(playerid)
OnPlayerLeaveCheckpoint(playerid)
OnPlayerEnterRaceCheckpoint(playerid)
OnPlayerLeaveRaceCheckpoint(playerid)
OnPlayerPickUpPickup(playerid, pickupid)
OnPlayerSelectedMenuRow(playerid, row)
OnPlayerExitedMenu(playerid)
OnPlayerStreamIn(playerid, forplayerid)
OnPlayerStreamOut(playerid, forplayerid)
OnPlayerTakeDamage(playerid, issuerid, Float:amount, weaponid, bodypart)
OnPlayerGiveDamage(playerid, damagedid, Float:amount, weaponid, bodypart)
OnPlayerWeaponShot(playerid, weaponid, hittype, hitid, Float:fX, Float:fY, Float:fZ)
OnPlayerClickMap(playerid, Float:fX, Float:fY, Float:fZ)
OnPlayerClickPlayer(playerid, clickedplayerid, source)
OnPlayerClickTextDraw(playerid, Text:clickedid)
OnPlayerClickPlayerTextDraw(playerid, PlayerText:playertextid)
OnPlayerEditObject(playerid, playerobject, objectid, response, Float:fX, Float:fY, Float:fZ, Float:fRotX, Float:fRotY, Float:fRotZ)
OnPlayerSelectObject(playerid, type, objectid, modelid, Float:fX, Float:fY, Float:fZ)
OnDialogResponse(playerid, dialogid, response, listitem, inputtext[])
OnVehicleSpawn(vehicleid)
OnVehicleDeath(vehicleid, killerid)
OnVehicleMod(playerid, vehicleid, componentid)
OnVehiclePaintjob(playerid, vehicleid, paintjobid)
OnVehicleRespray(playerid, vehicleid, color1, color2)
OnVehicleDamageStatusUpdate(vehicleid, playerid)
OnVehicleStreamIn(vehicleid, forplayerid)
OnVehicleStreamOut(vehicleid, forplayerid)
OnUnoccupiedVehicleUpdate(vehicleid, playerid, passenger_seat, Float:new_x, Float:new_y, Float:new_z, Float:vel_x, Float:vel_y, Float:vel_z)
OnObjectMoved(objectid)
OnPlayerObjectMoved(playerid, objectid)
OnActorStreamIn(actorid, forplayerid)
OnActorStreamOut(actorid, forplayerid)
OnRconCommand(cmd[])
OnRconLoginAttempt(ip[], password[], success)
OnIncomingConnection(playerid, ip_address[], port)
`;

/** Native / fungsi umum: nama(params). Parameter berisi " = " dianggap opsional. */
const NATIVES = `
print(const string[])
printf(const format[], {Float,_}:...)
format(output[], len, const format[], {Float,_}:...)
SendClientMessage(playerid, color, const message[])
SendClientMessageToAll(color, const message[])
SendPlayerMessageToPlayer(playerid, senderid, const message[])
SendPlayerMessageToAll(senderid, const message[])
SendDeathMessage(killer, killee, weapon)
SendRconCommand(const command[])
GameTextForPlayer(playerid, const string[], time, style)
GameTextForAll(const string[], time, style)
ShowPlayerDialog(playerid, dialogid, style, const caption[], const info[], const button1[], const button2[])
SetPlayerPos(playerid, Float:x, Float:y, Float:z)
GetPlayerPos(playerid, &Float:x, &Float:y, &Float:z)
SetPlayerPosFindZ(playerid, Float:x, Float:y, Float:z)
SetPlayerFacingAngle(playerid, Float:ang)
GetPlayerFacingAngle(playerid, &Float:ang)
SetPlayerHealth(playerid, Float:health)
GetPlayerHealth(playerid, &Float:health)
SetPlayerArmour(playerid, Float:armour)
GetPlayerArmour(playerid, &Float:armour)
SetPlayerSkin(playerid, skinid)
GetPlayerSkin(playerid)
SetPlayerName(playerid, const name[])
GetPlayerName(playerid, name[], len)
SetPlayerScore(playerid, score)
GetPlayerScore(playerid)
SetPlayerColor(playerid, color)
GetPlayerColor(playerid)
SetPlayerTeam(playerid, teamid)
GetPlayerTeam(playerid)
GivePlayerMoney(playerid, money)
GetPlayerMoney(playerid)
ResetPlayerMoney(playerid)
GivePlayerWeapon(playerid, weaponid, ammo)
ResetPlayerWeapons(playerid)
GetPlayerWeapon(playerid)
GetPlayerAmmo(playerid)
SetPlayerInterior(playerid, interiorid)
GetPlayerInterior(playerid)
SetPlayerVirtualWorld(playerid, worldid)
GetPlayerVirtualWorld(playerid)
SetPlayerCameraPos(playerid, Float:x, Float:y, Float:z)
SetPlayerCameraLookAt(playerid, Float:x, Float:y, Float:z, cut = CAMERA_CUT)
SetCameraBehindPlayer(playerid)
TogglePlayerControllable(playerid, toggle)
TogglePlayerSpectating(playerid, toggle)
SpawnPlayer(playerid)
SetSpawnInfo(playerid, team, skin, Float:x, Float:y, Float:z, Float:rotation, weapon1, weapon1_ammo, weapon2, weapon2_ammo, weapon3, weapon3_ammo)
ForceClassSelection(playerid)
ApplyAnimation(playerid, const animlib[], const animname[], Float:fDelta, loop, lockx, locky, freeze, time, forcesync = 0)
ClearAnimations(playerid, forcesync = 0)
SetPlayerSpecialAction(playerid, actionid)
GetPlayerSpecialAction(playerid)
SetPlayerChatBubble(playerid, const text[], color, Float:drawdistance, expiretime)
SetPlayerTime(playerid, hour, minute)
SetPlayerWeather(playerid, weather)
SetPlayerDrunkLevel(playerid, level)
SetPlayerWantedLevel(playerid, level)
PlayerPlaySound(playerid, soundid, Float:x, Float:y, Float:z)
PlayAudioStreamForPlayer(playerid, const url[], Float:posX = 0.0, Float:posY = 0.0, Float:posZ = 0.0, Float:distance = 50.0, usepos = 0)
StopAudioStreamForPlayer(playerid)
IsPlayerConnected(playerid)
IsPlayerInAnyVehicle(playerid)
IsPlayerInVehicle(playerid, vehicleid)
IsPlayerInRangeOfPoint(playerid, Float:range, Float:x, Float:y, Float:z)
GetPlayerDistanceFromPoint(playerid, Float:X, Float:Y, Float:Z)
GetPlayerVehicleID(playerid)
GetPlayerVehicleSeat(playerid)
GetPlayerState(playerid)
GetPlayerIp(playerid, name[], len)
GetPlayerPing(playerid)
GetPlayerKeys(playerid, &keys, &updown, &leftright)
GetMaxPlayers()
Kick(playerid)
Ban(playerid)
BanEx(playerid, const reason[])
PutPlayerInVehicle(playerid, vehicleid, seatid)
RemovePlayerFromVehicle(playerid)
SetPlayerCheckpoint(playerid, Float:x, Float:y, Float:z, Float:size)
DisablePlayerCheckpoint(playerid)
SetPlayerRaceCheckpoint(playerid, type, Float:x, Float:y, Float:z, Float:nextx, Float:nexty, Float:nextz, Float:size)
DisablePlayerRaceCheckpoint(playerid)
SetPlayerMapIcon(playerid, iconid, Float:x, Float:y, Float:z, markertype, color, style = MAPICON_LOCAL)
RemovePlayerMapIcon(playerid, iconid)
SetPlayerWorldBounds(playerid, Float:x_max, Float:x_min, Float:y_max, Float:y_min)
CreateVehicle(modelid, Float:x, Float:y, Float:z, Float:rotation, color1, color2, respawn_delay, addsiren = 0)
DestroyVehicle(vehicleid)
IsValidVehicle(vehicleid)
SetVehiclePos(vehicleid, Float:x, Float:y, Float:z)
GetVehiclePos(vehicleid, &Float:x, &Float:y, &Float:z)
SetVehicleZAngle(vehicleid, Float:z_angle)
GetVehicleZAngle(vehicleid, &Float:z_angle)
SetVehicleHealth(vehicleid, Float:health)
GetVehicleHealth(vehicleid, &Float:health)
GetVehicleModel(vehicleid)
RepairVehicle(vehicleid)
SetVehicleToRespawn(vehicleid)
ChangeVehicleColor(vehicleid, color1, color2)
AddVehicleComponent(vehicleid, componentid)
SetVehicleNumberPlate(vehicleid, const numberplate[])
SetVehicleVirtualWorld(vehicleid, worldid)
SetVehicleParamsEx(vehicleid, engine, lights, alarm, doors, bonnet, boot, objective)
GetVehicleParamsEx(vehicleid, &engine, &lights, &alarm, &doors, &bonnet, &boot, &objective)
AddStaticVehicle(modelid, Float:spawn_x, Float:spawn_y, Float:spawn_z, Float:z_angle, color1, color2)
AddStaticVehicleEx(modelid, Float:spawn_x, Float:spawn_y, Float:spawn_z, Float:z_angle, color1, color2, respawn_delay, addsiren = 0)
AddStaticPickup(model, type, Float:X, Float:Y, Float:Z, virtualworld = 0)
CreatePickup(model, type, Float:X, Float:Y, Float:Z, virtualworld = 0)
DestroyPickup(pickup)
AddPlayerClass(modelid, Float:spawn_x, Float:spawn_y, Float:spawn_z, Float:z_angle, weapon1, weapon1_ammo, weapon2, weapon2_ammo, weapon3, weapon3_ammo)
CreateObject(modelid, Float:x, Float:y, Float:z, Float:rX, Float:rY, Float:rZ, Float:DrawDistance = 0.0)
DestroyObject(objectid)
SetObjectPos(objectid, Float:X, Float:Y, Float:Z)
MoveObject(objectid, Float:X, Float:Y, Float:Z, Float:Speed, Float:RotX = -1000.0, Float:RotY = -1000.0, Float:RotZ = -1000.0)
CreateActor(modelid, Float:X, Float:Y, Float:Z, Float:Rotation)
DestroyActor(actorid)
Create3DTextLabel(const text[], color, Float:X, Float:Y, Float:Z, Float:DrawDistance, virtualworld, testLOS)
Delete3DTextLabel(Text3D:id)
TextDrawCreate(Float:x, Float:y, const text[])
TextDrawDestroy(Text:text)
TextDrawShowForPlayer(playerid, Text:text)
TextDrawHideForPlayer(playerid, Text:text)
TextDrawShowForAll(Text:text)
TextDrawHideForAll(Text:text)
TextDrawSetString(Text:text, const string[])
TextDrawLetterSize(Text:text, Float:x, Float:y)
TextDrawTextSize(Text:text, Float:x, Float:y)
TextDrawAlignment(Text:text, alignment)
TextDrawColor(Text:text, color)
TextDrawFont(Text:text, font)
TextDrawSetOutline(Text:text, size)
TextDrawSetShadow(Text:text, size)
TextDrawBackgroundColor(Text:text, color)
TextDrawUseBox(Text:text, use)
TextDrawBoxColor(Text:text, color)
TextDrawSetProportional(Text:text, set)
TextDrawSetSelectable(Text:text, set)
CreatePlayerTextDraw(playerid, Float:x, Float:y, const text[])
PlayerTextDrawShow(playerid, PlayerText:text)
PlayerTextDrawHide(playerid, PlayerText:text)
PlayerTextDrawDestroy(playerid, PlayerText:text)
PlayerTextDrawSetString(playerid, PlayerText:text, const string[])
SetTimer(const funcname[], interval, repeating)
SetTimerEx(const funcname[], interval, repeating, const format[], {Float,_}:...)
KillTimer(timerid)
CallLocalFunction(const function[], const format[], {Float,_}:...)
CallRemoteFunction(const function[], const format[], {Float,_}:...)
SetGameModeText(const string[])
SetWorldTime(hour)
SetWeather(weatherid)
ShowNameTags(show)
ShowPlayerMarkers(mode)
EnableStuntBonusForAll(enable)
DisableInteriorEnterExits()
UsePlayerPedAnims()
SetNameTagDrawDistance(Float:distance)
LimitGlobalChatRadius(Float:chat_radius)
SetPVarInt(playerid, const varname[], int_value)
GetPVarInt(playerid, const varname[])
SetPVarFloat(playerid, const varname[], Float:float_value)
GetPVarFloat(playerid, const varname[])
SetPVarString(playerid, const varname[], const string_value[])
GetPVarString(playerid, const varname[], string_return[], len)
DeletePVar(playerid, const varname[])
strcmp(const string1[], const string2[], bool:ignorecase = false, length = cellmax)
strlen(const string[])
strcat(dest[], const source[], maxlength = sizeof dest)
strmid(dest[], const source[], start, end, maxlength = sizeof dest)
strfind(const string[], const sub[], bool:ignorecase = false, pos = 0)
strval(const string[])
valstr(dest[], value, bool:pack = false)
tolower(c)
toupper(c)
random(max)
floatsqroot(Float:value)
floatabs(Float:value)
floatround(Float:value, floatround_method:method = floatround_round)
floatpower(Float:value, Float:exponent)
floatsin(Float:value, anglemode:mode = radian)
floatcos(Float:value, anglemode:mode = radian)
floatstr(const string[])
float(value)
min(value1, value2)
max(value1, value2)
clamp(value, min = cellmin, max = cellmax)
abs(value)
gettime(&hour = 0, &minute = 0, &second = 0)
getdate(&year = 0, &month = 0, &day = 0)
GetTickCount()
fopen(const name[], filemode:mode = io_readwrite)
fclose(File:handle)
fwrite(File:handle, const string[])
fread(File:handle, string[], size = sizeof string, bool:pack = false)
fexist(const name[])
fremove(const name[])
`;

const CONSTANTS = `
MAX_PLAYERS MAX_VEHICLES MAX_OBJECTS MAX_PICKUPS MAX_PLAYER_NAME INVALID_PLAYER_ID INVALID_VEHICLE_ID
INVALID_OBJECT_ID INVALID_ACTOR_ID INVALID_TEXT_DRAW NO_TEAM CAMERA_CUT CAMERA_MOVE MAPICON_LOCAL MAPICON_GLOBAL
DIALOG_STYLE_MSGBOX DIALOG_STYLE_INPUT DIALOG_STYLE_LIST DIALOG_STYLE_PASSWORD DIALOG_STYLE_TABLIST DIALOG_STYLE_TABLIST_HEADERS
PLAYER_STATE_NONE PLAYER_STATE_ONFOOT PLAYER_STATE_DRIVER PLAYER_STATE_PASSENGER PLAYER_STATE_SPAWNED PLAYER_STATE_WASTED PLAYER_STATE_SPECTATING
KEY_ACTION KEY_CROUCH KEY_FIRE KEY_SPRINT KEY_SECONDARY_ATTACK KEY_JUMP KEY_LOOK_RIGHT KEY_HANDBRAKE KEY_LOOK_LEFT KEY_SUBMISSION
KEY_WALK KEY_YES KEY_NO KEY_CTRL_BACK KEY_UP KEY_DOWN KEY_LEFT KEY_RIGHT
SPECIAL_ACTION_NONE SPECIAL_ACTION_DUCK SPECIAL_ACTION_USEJETPACK SPECIAL_ACTION_ENTER_VEHICLE SPECIAL_ACTION_EXIT_VEHICLE
SPECIAL_ACTION_DANCE1 SPECIAL_ACTION_DANCE2 SPECIAL_ACTION_DANCE3 SPECIAL_ACTION_DANCE4 SPECIAL_ACTION_HANDSUP
SPECIAL_ACTION_USECELLPHONE SPECIAL_ACTION_STOPUSECELLPHONE SPECIAL_ACTION_DRINK_BEER SPECIAL_ACTION_SMOKE_CIGGY
WEAPON_BRASSKNUCKLE WEAPON_GOLFCLUB WEAPON_NITESTICK WEAPON_KNIFE WEAPON_BAT WEAPON_COLT45 WEAPON_SILENCED WEAPON_DEAGLE
WEAPON_SHOTGUN WEAPON_SAWEDOFF WEAPON_SHOTGSPA WEAPON_UZI WEAPON_MP5 WEAPON_AK47 WEAPON_M4 WEAPON_TEC9 WEAPON_RIFLE
WEAPON_SNIPER WEAPON_ROCKETLAUNCHER WEAPON_GRENADE WEAPON_MOLTOV WEAPON_PARACHUTE WEAPON_VEHICLE WEAPON_DROWN WEAPON_COLLISION
CLICK_SOURCE_SCOREBOARD BULLET_HIT_TYPE_NONE BULLET_HIT_TYPE_PLAYER BULLET_HIT_TYPE_VEHICLE BULLET_HIT_TYPE_OBJECT
floatround_round floatround_floor floatround_ceil floatround_tozero io_read io_write io_readwrite
cellmax cellmin EOS
`;

const KEYWORDS =
    "assert break case continue default do else exit for goto if return sizeof sleep state switch tagof while defined char operator foreach forward native public stock static new const enum true false";

const TAGS = [
    "Float:",
    "bool:",
    "Text:",
    "PlayerText:",
    "Text3D:",
    "PlayerText3D:",
    "File:",
    "_:"
];

const DIRECTIVES: Array<[string, string?]> = [
    ["#include", "#include <${1:a_samp}>"],
    ['#include ""', '#include "${1:modules/file.pwn}"'],
    ["#tryinclude", "#tryinclude <${1:name}>"],
    ["#define", "#define ${1:NAME} ${2:value}"],
    ["#undef"],
    ["#if"],
    ["#elseif"],
    ["#else"],
    ["#endif"],
    ["#pragma"],
    ["#error"],
    ["#warning"],
    ["#endinput"],
    ["#emit"],
    ["#assert"]
];

/** Snippet: label -> [template, keterangan] */
const SNIPPETS: Array<[string, string, string]> = [
    [
        "for",
        "for (new ${1:i} = 0; ${1:i} < ${2:MAX_PLAYERS}; ${1:i}++)\n{\n\t${}\n}",
        "loop for"
    ],
    [
        "foreach",
        "foreach (new ${1:i} : ${2:Player})\n{\n\t${}\n}",
        "loop foreach (y_iterate)"
    ],
    ["while", "while (${1:condition})\n{\n\t${}\n}", "loop while"],
    ["do", "do\n{\n\t${}\n}\nwhile (${1:condition});", "loop do-while"],
    ["if", "if (${1:condition})\n{\n\t${}\n}", "kondisi if"],
    ["ifelse", "if (${1:condition})\n{\n\t${}\n}\nelse\n{\n\t\n}", "if / else"],
    ["else", "else\n{\n\t${}\n}", "else"],
    [
        "switch",
        "switch (${1:value})\n{\n\tcase ${2:0}:\n\t{\n\t\t${}\n\t}\n}",
        "switch / case"
    ],
    ["case", "case ${1:0}:\n{\n\t${}\n}", "case"],
    [
        "public",
        "public ${1:Name}(${2:playerid})\n{\n\t${}\n\treturn 1;\n}",
        "fungsi public"
    ],
    [
        "stock",
        "stock ${1:Name}(${2:playerid})\n{\n\t${}\n\treturn 1;\n}",
        "fungsi stock"
    ],
    ["forward", "forward ${1:Name}(${2:playerid});", "deklarasi forward"],
    ["native", "native ${1:Name}(${2:params});", "deklarasi native"],
    ["enum", "enum ${1:E_NAME}\n{\n\t${}\n}", "enum"],
    [
        "cmd",
        "CMD:${1:name}(playerid, params[])\n{\n\t${}\n\treturn 1;\n}",
        "perintah zcmd"
    ],
    [
        "dialog",
        "if (dialogid == ${1:DIALOG_ID})\n{\n\tif (!response) return 1;\n\t${}\n\treturn 1;\n}",
        "blok OnDialogResponse"
    ],
    [
        "timer",
        'SetTimerEx("${1:Function}", ${2:1000}, ${3:false}, "${4:i}", ${5:playerid});',
        "SetTimerEx"
    ],
    [
        "fmtmsg",
        'new ${1:str}[${2:144}];\nformat(${1:str}, sizeof(${1:str}), "${3:%s}", ${4:args});\nSendClientMessage(${5:playerid}, ${6:-1}, ${1:str});',
        "format + SendClientMessage"
    ],
    [
        "notconn",
        "if (!IsPlayerConnected(${1:playerid})) return 0;",
        "cek pemain terhubung"
    ],
    ["newarr", "new ${1:name}[${2:MAX_PLAYERS}];", "array global"],
    [
        "gamemode",
        '#include <a_samp>\n\nmain()\n{\n\tprint("${1:Gamemode loaded}");\n}\n\npublic OnGameModeInit()\n{\n\tSetGameModeText("${2:Gamemode}");\n\tAddPlayerClass(0, 0.0, 0.0, 3.0, 0.0, 0, 0, 0, 0, 0, 0);\n\treturn 1;\n}\n\npublic OnGameModeExit()\n{\n\treturn 1;\n}\n',
        "kerangka gamemode"
    ],
    [
        "filterscript",
        "#include <a_samp>\n\npublic OnFilterScriptInit()\n{\n\t${}\n\treturn 1;\n}\n\npublic OnFilterScriptExit()\n{\n\treturn 1;\n}\n",
        "kerangka filterscript"
    ]
];

/* ----------------------------- util template ----------------------------- */

const STRING_PARAMS =
    /^(message|string|text|caption|info|button1|button2|format|reason|funcname|command|cmdtext|numberplate|animlib|animname|url|function)$/;

interface ParsedFn {
    name: string;
    params: string;
}

function parseFnLine(line: string): ParsedFn | null {
    const m = line.trim().match(/^([A-Za-z_@][\w@]*)\((.*)\)$/);
    return m ? { name: m[1], params: m[2].trim() } : null;
}

/** Pecah parameter pada koma tingkat atas. */
function splitParams(params: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of params) {
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        if (ch === "," && depth === 0) {
            out.push(cur.trim());
            cur = "";
        } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

/** "Float:x" / "const message[]" / "&Float:x" -> nama polos. */
function paramName(p: string): string {
    let s = p
        .replace(/\s*=.*$/, "")
        .replace(/^const\s+/, "")
        .replace(/^&/, "");
    s = s
        .replace(/\[[^\]]*\]/g, "")
        .replace(/^(?:\{[^}]*\}|[A-Za-z_@][\w@]*):/, "")
        .trim();
    return s || "arg";
}

/** Template snippet: nama(${1:a}, ${2:b}); parameter opsional dilewati. */
function callTemplate(name: string, params: string): string {
    const req = splitParams(params).filter(
        p => p && p !== "..." && !/=/.test(p) && !/^\{.*\}:\.\.\.$/.test(p)
    );
    if (!req.length) return `${name}(\${})`;
    const inner = req
        .map((p, i) => {
            const n = paramName(p).replace(/[${}\\]/g, "");
            const isStr =
                /^const\s/.test(p) &&
                /\[\s*\]/.test(p) &&
                STRING_PARAMS.test(n);
            return isStr ? `"\${${i + 1}:${n}}"` : `\${${i + 1}:${n}}`;
        })
        .join(", ");
    return `${name}(${inner})`;
}

/** Snippet -> teks biasa (bila API snippet Acode tidak tersedia). */
function plainText(tpl: string): string {
    return tpl.replace(/\$\{\d*:?([^}]*)\}/g, "$1");
}

function acModule(): any {
    for (const name of ["codemirror", "@codemirror/autocomplete"]) {
        try {
            const m = g.acode.require(name);
            if (m?.snippetCompletion) return m;
            if (m?.autocomplete?.snippetCompletion) return m.autocomplete;
        } catch {
            /* coba berikutnya */
        }
    }
    return null;
}

/** Bangun satu objek Completion (dengan snippet bila bisa). */
function opt(
    label: string,
    type: string,
    detail: string,
    tpl?: string,
    boost = 0,
    info?: string
): any {
    const base: any = { label, type, detail, boost };
    if (info) base.info = info;
    if (!tpl) return base;
    const snip = acModule()?.snippetCompletion;
    return snip ? snip(tpl, base) : { ...base, apply: plainText(tpl) };
}

/* ------------------------------ bawaan ------------------------------ */

interface Builtins {
    cbFull: any[];
    cbPublic: any[];
    cbForward: any[];
    rest: any[];
    cbNames: Set<string>;
}

let builtins: Builtins | null = null;

function buildBuiltins(): Builtins {
    const cbFull: any[] = [];
    const cbPublic: any[] = [];
    const cbForward: any[] = [];
    const cbNames = new Set<string>();
    for (const line of CALLBACKS.split("\n")) {
        const f = parseFnLine(line);
        if (!f) continue;
        cbNames.add(f.name);
        const sig = `${f.name}(${f.params})`;
        const body = `${sig}\n{\n\t\${}\n\treturn 1;\n}`;
        cbFull.push(opt(f.name, "method", "callback", `public ${body}`, 20));
        cbPublic.push(opt(f.name, "method", "callback", body, 20));
        cbForward.push(opt(f.name, "method", "callback", `${sig};`, 20));
    }

    const rest: any[] = [];
    for (const [label, tpl, d] of SNIPPETS)
        rest.push(opt(label, "text", d, tpl, -2));
    for (const line of NATIVES.split("\n")) {
        const f = parseFnLine(line);
        if (f)
            rest.push(
                opt(
                    f.name,
                    "function",
                    `(${f.params})`,
                    callTemplate(f.name, f.params),
                    0
                )
            );
    }
    for (const c of CONSTANTS.split(/\s+/).filter(Boolean))
        rest.push(opt(c, "constant", "", undefined, -1));
    for (const k of KEYWORDS.split(" "))
        rest.push(opt(k, "keyword", "", undefined, -3));
    for (const t of TAGS) rest.push(opt(t, "type", "tag", undefined, -4));
    return { cbFull, cbPublic, cbForward, rest, cbNames };
}

function getBuiltins(): Builtins {
    return (builtins ??= buildBuiltins());
}

function directiveOptions(): any[] {
    return DIRECTIVES.map(([l, tpl]) =>
        opt(l, "keyword", "preprocessor", tpl, 0)
    );
}

/* ------------------------------ ekstraksi simbol ------------------------------ */

type Kind = "fn" | "macro" | "var" | "enum" | "const";
interface Sym {
    name: string;
    kind: Kind;
    params?: string;
    src: string;
    url?: string; // lokasi file sumber (untuk #include otomatis)
    mod?: boolean; // berasal dari folder modul gamemode
}

const ID = "[A-Za-z_@][\\w@]*";
const FN_RE = new RegExp(
    `^[ \\t]*(?:(?:static|public|stock|forward|native)[ \\t]+)+(?:${ID}:[ \\t]*)?(${ID})[ \\t]*\\(([^)]*)\\)`,
    "gm"
);
// fungsi biasa tanpa keyword: "Foo(playerid)\n{" atau "Float:Foo(a, b) {"
const PLAIN_FN_RE = new RegExp(
    `^[ \\t]*(?:(${ID}):[ \\t]*)?(${ID})[ \\t]*\\(([^()]*)\\)(?=[ \\t]*(?:\\r?\\n[ \\t]*)?\\{)`,
    "gm"
);
const MACRO_RE = new RegExp(
    `^[ \\t]*#[ \\t]*define[ \\t]+(${ID})(?:\\(([^)]*)\\))?`,
    "gm"
);
const VAR_RE =
    /^[ \t]*(?:(?:static|stock)[ \t]+)*(?:new|const|static)\b([^;\n]*)/gm;
const ENUM_RE = new RegExp(`^[ \\t]*enum\\b([^{\\n]*)\\{([^}]*)\\}`, "gm");

function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function firstId(part: string): string | null {
    const m = part.match(
        new RegExp(
            `^\\s*(?:(?:const|static|new|stock)\\s+)*(?:(?:${ID}|\\{[^}]*\\}):\\s*)*(${ID})`
        )
    );
    return m ? m[1] : null;
}

/** Ambil simbol dari teks Pawn (komentar sudah dibuang). */
function extract(text: string, src: string): Sym[] {
    const out: Sym[] = [];
    let m: RegExpExecArray | null;

    FN_RE.lastIndex = 0;
    while ((m = FN_RE.exec(text)))
        out.push({
            name: m[1],
            kind: "fn",
            params: m[2].replace(/\s+/g, " ").trim(),
            src
        });

    PLAIN_FN_RE.lastIndex = 0;
    while ((m = PLAIN_FN_RE.exec(text))) {
        if (NOT_FN.has(m[2]) || (m[1] && CMD_TAG_RE.test(m[1]))) continue;
        out.push({
            name: m[2],
            kind: "fn",
            params: m[3].replace(/\s+/g, " ").trim(),
            src
        });
    }

    MACRO_RE.lastIndex = 0;
    while ((m = MACRO_RE.exec(text))) {
        const hasParams = m[2] !== undefined;
        out.push({
            name: m[1],
            kind: hasParams ? "fn" : "const",
            params: hasParams ? m[2].trim() : undefined,
            src
        });
    }

    ENUM_RE.lastIndex = 0;
    while ((m = ENUM_RE.exec(text))) {
        const en = m[1].match(new RegExp(`(?:${ID}:)?\\s*(${ID})`));
        if (en) out.push({ name: en[1], kind: "enum", src });
        for (const part of m[2].split(",")) {
            const id = firstId(part);
            if (id) out.push({ name: id, kind: "const", src });
        }
    }

    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(text))) {
        let body = m[1].replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
        for (let i = 0; i < 6; i++) {
            const next = body
                .replace(/\{[^{}]*\}/g, "")
                .replace(/\([^()]*\)/g, "");
            if (next === body) break;
            body = next;
        }
        for (const part of body.split(",")) {
            const id = firstId(part);
            if (id) out.push({ name: id, kind: "var", src });
        }
    }
    return out;
}

function shortSrc(src?: string): string {
    return src ? ` \u00b7 ${src.split("/").pop()}` : "";
}

function escRe(t: string): string {
    return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecode(t: string): string {
    try {
        return decodeURIComponent(t);
    } catch {
        return t;
    }
}

/** Path relatif dari folder file aktif ke file sumber simbol. */
function relInclude(activeUri: string, symUrl: string): string {
    const root = project?.modRoot;
    let A: string[];
    let T: string[];
    if (
        root &&
        activeUri.startsWith(root + "/") &&
        symUrl.startsWith(root + "/")
    ) {
        A = activeUri
            .slice(root.length + 1)
            .split("/")
            .slice(0, -1);
        T = symUrl.slice(root.length + 1).split("/");
    } else {
        A = urlDirname(activeUri).split("/");
        T = symUrl.split("/");
    }
    A = A.map(safeDecode);
    T = T.map(safeDecode);
    let k = 0;
    while (k < A.length && k < T.length - 1 && A[k] === T[k]) k++;
    return "../".repeat(A.length - k) + T.slice(k).join("/");
}

/** Tambahkan #include "<modul>" bila file aktif belum meng-include-nya. */
function addInclude(view: any, s: Sym): void {
    const f = g.editorManager?.activeFile;
    if (!s.url || !f?.uri || f.uri === s.url || !FILE_RE.test(f.name ?? ""))
        return;
    const doc = view.state.doc;
    const text: string = doc.toString();
    const stem = (s.url.split("/").pop() ?? "").replace(/\.(inc|pwn|p)$/i, "");
    const have = new RegExp(
        `#\\s*(?:try)?include\\s*[<"][^>"]*${escRe(stem)}(?:\\.(?:inc|pwn|p))?[>"]`
    );
    if (have.test(text)) return;
    const line = `#include "${relInclude(f.uri, s.url)}"`;
    let last = -1;
    const re = /^[ \t]*#[ \t]*(?:try)?include\b.*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) last = m.index + m[0].length;
    view.dispatch(
        last < 0
            ? { changes: { from: 0, insert: line + "\n" } }
            : { changes: { from: last, insert: "\n" + line } }
    );
}

function withInclude(o: any, s: Sym): any {
    if (!s.mod || !s.url) return o;
    const inner = o.apply;
    o.apply = (view: any, c: any, from: number, to: number) => {
        if (typeof inner === "function") {
            inner(view, c, from, to);
        } else {
            const ins = typeof inner === "string" ? inner : o.label;
            view.dispatch({
                changes: { from, to, insert: ins },
                selection: { anchor: from + ins.length },
                userEvent: "input.complete"
            });
        }
        try {
            addInclude(view, s);
        } catch (e) {
            console.warn("Pawno: failed to add #include", e);
        }
    };
    return o;
}

function symOption(s: Sym, boost: number): any {
    return withInclude(symOptionRaw(s, boost), s);
}

function symOptionRaw(s: Sym, boost: number): any {
    switch (s.kind) {
        case "fn":
            return opt(
                s.name,
                "function",
                `(${s.params ?? ""})${shortSrc(s.src)}`,
                callTemplate(s.name, s.params ?? ""),
                boost,
                s.src || undefined
            );
        case "enum":
            return opt(
                s.name,
                "class",
                `enum${shortSrc(s.src)}`,
                undefined,
                boost,
                s.src || undefined
            );
        case "const":
            return opt(
                s.name,
                "constant",
                shortSrc(s.src).replace(" \u00b7 ", ""),
                undefined,
                boost,
                s.src || undefined
            );
        default:
            return opt(
                s.name,
                "variable",
                shortSrc(s.src).replace(" \u00b7 ", ""),
                undefined,
                boost,
                s.src || undefined
            );
    }
}

/* --------------------------- file yang sedang dibuka --------------------------- */

let docCache: { doc: any; at: number; opts: any[] } = {
    doc: null,
    at: 0,
    opts: []
};

function docOptions(state: any): any[] {
    const doc = state.doc;
    const now = Date.now();
    if (docCache.doc !== doc && now - docCache.at > 700) {
        let opts: any[] = [];
        if (doc.length < 800_000) {
            const seen = new Set<string>();
            for (const s of extract(stripComments(doc.toString()), "")) {
                if (seen.has(s.name)) continue;
                seen.add(s.name);
                opts.push(symOption(s, 12));
            }
        }
        docCache = { doc, at: now, opts };
    }
    return docCache.opts;
}

/* ------------------------------- file .inc project ------------------------------- */

const MAX_FILES = 600;
const MAX_DEPTH = 2; // folder include
const MODULE_DEPTH = 6; // folder gamemode/<nama>/ (rekursif)
const MAX_CHARS = 500_000;

interface Project {
    key: string;
    at: number;
    dirs: string[];
    files: number;
    syms: Sym[];
    includeNames: string[];
    opts: any[] | null; // dibangun lazy
    failed: string[];
    folders: Array<{ path: string; pwn: number; inc: number }>;
    modRoot: string | null;
}

let project: Project | null = null;
let scanning = false;
let scanStartedAt = 0;
let lastScan: {
    uri: string;
    modRoot: string | null;
    ms: number;
    error: string;
} | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function listInc(
    dirUrl: string,
    rel: string,
    depth: number,
    out: Array<{ url: string; name: string }>,
    maxDepth = MAX_DEPTH,
    re: RegExp = INC_RE,
    stat?: Map<string, { pwn: number; inc: number }>
) {
    // catat setiap folder yang dimasuki, termasuk yang tidak berisi .pwn
    const here = rel || ".";
    if (stat && !stat.has(here)) stat.set(here, { pwn: 0, inc: 0 });
    let entries: any[];
    try {
        entries = await (await fsop(dirUrl)).lsDir();
    } catch {
        return;
    }
    for (const e of entries) {
        if (out.length >= MAX_FILES) return;
        const name = String(e?.name ?? "");
        if (!name || name.startsWith(".")) continue;
        if (e.isDirectory) {
            if (depth < maxDepth && !SKIP_DIRS.has(name.toLowerCase()))
                await listInc(
                    e.url,
                    rel ? `${rel}/${name}` : name,
                    depth + 1,
                    out,
                    maxDepth,
                    re,
                    stat
                );
        } else if (re.test(name)) {
            if (stat) {
                const c = stat.get(here)!;
                if (/\.pwn$/i.test(name)) c.pwn++;
                else c.inc++;
            }
            out.push({ url: e.url, name: rel ? `${rel}/${name}` : name });
        }
    }
}

async function readSource(url: string): Promise<string> {
    const raw = await (await fsop(url)).readFile("utf8");
    const text =
        typeof raw === "string"
            ? raw
            : new TextDecoder().decode(new Uint8Array(raw as ArrayBuffer));
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}

async function includeDirs(
    fileUrl: string,
    fileName: string
): Promise<string[]> {
    const dir = urlDirname(fileUrl);
    const parent = urlDirname(dir);
    const dirs = [
        dir,
        urlJoin(dir, "include"),
        urlJoin(parent, "pawno", "include"),
        urlJoin(parent, "qawno", "include"),
        urlJoin(parent, "include")
    ];
    try {
        const plan = await findTask(fileUrl);
        if (plan) {
            dirs.push(...forWasm(plan, fileName).includeUrls);
            dirs.push(
                urlJoin(plan.rootUrl, "pawno", "include"),
                urlJoin(plan.rootUrl, "qawno", "include")
            );
        }
    } catch {
        /* task.json tidak ada / tidak valid: pakai tebakan folder saja */
    }
    return [...new Set(dirs.filter(Boolean))];
}

function lastSegment(u: string): string {
    const seg = u.replace(/\/+$/, "").split("/").pop() ?? "";
    let d = seg;
    try {
        d = decodeURIComponent(seg);
    } catch {
        /* pakai apa adanya */
    }
    // URL SAF: "primary:Acode/EclipseCity/gamemodes" -> "gamemodes"
    return (d.split(":").pop() ?? d).split("/").filter(Boolean).pop() ?? d;
}

/**
 * Akar pindai modul: folder bernama gamemode/gamemodes yang menaungi file
 * aktif (file di gamemodes/ langsung, atau di subfoldernya seperti
 * gamemodes/CORE/). Seluruh isinya dipindai rekursif, jadi modul dengan
 * nama folder apa pun ikut terbaca. null bila tidak ada folder seperti itu.
 */
function moduleRoot(fileUrl: string): string | null {
    let cur = urlDirname(fileUrl);
    for (let i = 0; i < 10; i++) {
        if (GAMEMODE_DIR_RE.test(lastSegment(cur))) return cur;
        const parent = urlDirname(cur);
        if (!parent || parent === cur) return null;
        cur = parent;
    }
    return null;
}

async function scanProject(force: boolean): Promise<void> {
    const f = g.editorManager?.activeFile;
    if (!f?.uri || !FILE_RE.test(f.name ?? "")) return;
    const dirs = await includeDirs(f.uri, f.name);
    const modRoot = moduleRoot(f.uri);
    const key = [...dirs, modRoot ?? ""].join("|");
    if (
        !force &&
        project &&
        project.key === key &&
        Date.now() - project.at < 30_000
    )
        return;

    const t0 = Date.now();
    lastScan = { uri: f.uri, modRoot, ms: 0, error: "" };
    const files: Array<{ url: string; name: string }> = [];
    // folder include dulu, lalu modul .pwn/.inc di gamemode/<nama>/
    for (const d of dirs) await listInc(d, "", 0, files);
    const stat = new Map<string, { pwn: number; inc: number }>();
    const before = files.length;
    if (modRoot)
        await listInc(modRoot, "", 0, files, MODULE_DEPTH, SRC_RE, stat);
    const modUrls = new Set(files.slice(before).map(x => x.url));
    const uniq = new Map<string, { url: string; name: string }>();
    for (const x of files) if (!uniq.has(x.url)) uniq.set(x.url, x);
    files.length = 0;
    files.push(...uniq.values());

    const syms = new Map<string, Sym>();
    const failed: string[] = [];
    const names = new Set<string>();
    for (let i = 0; i < files.length; i += 6) {
        const batch = files.slice(i, i + 6);
        const texts = await Promise.all(
            batch.map(b =>
                readSource(b.url).catch(() => {
                    failed.push(b.name);
                    return "";
                })
            )
        );
        batch.forEach((b, j) => {
            names.add(
                INC_RE.test(b.name) ? b.name.replace(INC_RE, "") : b.name
            );
            if (!texts[j]) return;
            for (const s of extract(stripComments(texts[j]), b.name)) {
                if (syms.has(s.name)) continue;
                s.url = b.url;
                s.mod = modUrls.has(b.url);
                syms.set(s.name, s);
            }
        });
    }
    project = {
        key,
        at: Date.now(),
        dirs: modRoot ? [modRoot, ...dirs] : dirs,
        files: files.length,
        syms: [...syms.values()],
        includeNames: [...names].sort(),
        opts: null,
        failed,
        modRoot,
        folders: [...stat.entries()]
            .map(([path, c]) => ({ path, ...c }))
            .sort((a, b) => a.path.localeCompare(b.path))
    };
    lastScan.ms = Date.now() - t0;
}

/** Pindai ulang file .inc project (ditunda & dibatasi supaya ringan). */
export function refreshProjectSymbols(force = false): Promise<void> {
    return new Promise(resolve => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
            timer = null;
            // penjaga: pindai yang macet >60 dtk tidak boleh memblokir selamanya
            if (scanning && Date.now() - scanStartedAt < 60_000)
                return resolve();
            scanning = true;
            scanStartedAt = Date.now();
            try {
                await scanProject(force);
            } catch (e) {
                console.warn("Pawno: failed to scan includes", e);
                if (lastScan) lastScan.error = String((e as any)?.message ?? e);
            } finally {
                scanning = false;
                resolve();
            }
        }, 400);
    });
}

function projectOptions(): any[] {
    if (!project) return [];
    return (project.opts ??= project.syms.map(s => symOption(s, 6)));
}

/* --------------------------------- sumber saran --------------------------------- */

function inStringOrComment(before: string): boolean {
    if (/^\s*\*/.test(before)) return true;
    let quote = "";
    for (let i = 0; i < before.length; i++) {
        const c = before[i];
        if (quote) {
            if (c === "\\") i++;
            else if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === "/" && before[i + 1] === "/") return true;
    }
    return !!quote;
}

function complete(ctx: any): any {
    const { state, pos } = ctx;
    const line = state.doc.lineAt(pos);
    const before: string = line.text.slice(0, pos - line.from);
    if (inStringOrComment(before)) return null;

    // #include <nama> / #include "nama"
    const inc = before.match(/^\s*#\s*(?:try)?include\s*[<"]([\w/.\-]*)$/);
    if (inc) {
        const names = project?.includeNames ?? [];
        if (!names.length) return null;
        return {
            from: pos - inc[1].length,
            options: names.map(n => ({
                label: n,
                type: "text",
                detail: "include"
            })),
            validFor: /^[\w/.\-]*$/
        };
    }

    const word = ctx.matchBefore(/#?[A-Za-z_@][\w@]*|#/);
    if (!word && !ctx.explicit) return null;
    const from = word ? word.from : pos;
    const text = word ? word.text : "";
    if (from > line.from && /\d/.test(line.text[from - line.from - 1] ?? ""))
        return null;
    if (!ctx.explicit && text.replace("#", "").length < 2 && text !== "#")
        return null;

    const b = getBuiltins();

    if (text.startsWith("#")) {
        return { from, options: directiveOptions(), validFor: /^#?[\w@]*$/ };
    }

    const head = line.text.slice(0, from - line.from);
    if (/(?:^|[\s;{}])public\s+(?:[A-Za-z_@][\w@]*:\s*)?$/.test(head)) {
        return { from, options: b.cbPublic, validFor: /^[\w@]*$/ };
    }
    if (/(?:^|[\s;{}])forward\s+(?:[A-Za-z_@][\w@]*:\s*)?$/.test(head)) {
        return { from, options: b.cbForward, validFor: /^[\w@]*$/ };
    }
    // sedang memberi nama baru (new x / stock Foo / enum E): jangan ganggu
    if (
        !ctx.explicit &&
        /(?:^|[\s;{}])(?:new|static|const|stock|native|enum)\s+(?:[A-Za-z_@][\w@]*:\s*)?$/.test(
            head
        )
    ) {
        return null;
    }

    const seen = new Set<string>();
    const options: any[] = [];
    const push = (o: any) => {
        if (seen.has(o.label)) return;
        seen.add(o.label);
        options.push(o);
    };
    b.cbFull.forEach(push);
    docOptions(state).forEach(o => !b.cbNames.has(o.label) && push(o));
    projectOptions().forEach(o => !b.cbNames.has(o.label) && push(o));
    b.rest.forEach(push);

    return { from, options, validFor: /^#?[\w@]*$/ };
}

/** Sumber saran untuk language data "autocomplete". */
export function createPawnCompletion(
    enabled: () => boolean
): (ctx: any) => any {
    return (ctx: any) => {
        try {
            if (!enabled()) return null;
            if (!project) void refreshProjectSymbols();
            return complete(ctx);
        } catch (e) {
            console.warn("Pawno: autocomplete error", e);
            return null;
        }
    };
}

/** Ringkasan status (untuk command debug). */
export function describeCompletion(): string {
    const lines: string[] = [];
    const ac = acModule();
    lines.push(
        `API snippet CodeMirror : ${ac?.snippetCompletion ? "available" : "NOT available (snippets become plain text)"}`
    );
    try {
        const b = getBuiltins();
        lines.push(
            `Built-in              : ${b.cbNames.size} callback, ${b.rest.length} saran lain`
        );
    } catch (e: any) {
        lines.push(
            `Built-in              : failed to build (${e?.message ?? e})`
        );
    }
    try {
        const st = g.editorManager?.editor?.state;
        const n = st?.languageDataAt?.("autocomplete", 0)?.length;
        lines.push(
            `Autocomplete language data in active editor: ${n === undefined ? "unreadable" : n + " sources"}`
        );
        lines.push(
            `Active file           : ${g.editorManager?.activeFile?.name ?? "-"}`
        );
    } catch {
        lines.push("Active editor          : unreadable");
    }
    if (!project) {
        lines.push(
            "Project                : not scanned yet (open a .pwn file and run again)"
        );
    } else {
        lines.push(
            `Project                : ${project.files} .inc/.pwn files, ${project.syms.length} symbols`
        );
        lines.push(`Scanned from          :\n  ${project.dirs.join("\n  ")}`);
        if (project.folders.length) {
            const rows = project.folders.slice(0, 40).map(f => {
                const tag = f.pwn
                    ? `${f.pwn} .pwn`
                    : f.inc
                      ? "tanpa .pwn"
                      : "kosong";
                return `  ${f.path === "." ? "(akar)" : f.path}: ${tag}${f.inc ? `, ${f.inc} .inc` : ""}`;
            });
            lines.push(`Folder modul           :\n${rows.join("\n")}`);
            if (project.folders.length > 40)
                lines.push(
                    `  ...and ${project.folders.length - 40} more folders`
                );
        }
        if (project.failed.length)
            lines.push(
                `Gagal dibaca           : ${project.failed.slice(0, 8).join(", ")}`
            );
    }
    if (lastScan) {
        lines.push(`Active file URI       : ${lastScan.uri}`);
        lines.push(
            `Module root            : ${lastScan.modRoot ?? "NOT found (no gamemode/gamemodes folder above this file)"}`
        );
        lines.push(`Waktu pindai           : ${lastScan.ms} ms`);
        if (lastScan.error)
            lines.push(`Error pindai           : ${lastScan.error}`);
    } else {
        lines.push("Scan                   : never ran");
    }
    return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Tampilan popup autocomplete berwarna (khusus file Pawn)            */
/* ------------------------------------------------------------------ */

const AC_STYLE_ID = "pawno-complete-style";
const AC_SCOPE = "pawno-ac";

const AC_COLORS: Record<string, string> = {
    function: "#82aaff", // fungsi / native / stock
    method: "#ff7eb6", // callback
    constant: "#f78c6c",
    variable: "#7dd3fc",
    class: "#ffcb6b", // enum
    type: "#ffcb6b", // tag
    keyword: "#c792ea",
    text: "#c3e88d" // nama include
};

function buildAcCss(): string {
    const S = `body.${AC_SCOPE}`;
    let css = `
${S} .cm-tooltip.cm-tooltip-autocomplete {
  background:#161b26; border:1px solid #2c3347; border-radius:10px;
  box-shadow:0 6px 24px rgba(0,0,0,.45); overflow:hidden;
}
${S} .cm-tooltip-autocomplete > ul > li { padding:3px 8px; color:#d6deeb; }
${S} .cm-tooltip-autocomplete > ul > li[aria-selected] {
  background:#26334f; color:#ffffff;
}
${S} .cm-completionIcon { opacity:1 !important; font-weight:700; }
${S} .cm-completionMatchedText {
  text-decoration:none !important; font-weight:700; color:#ffd580;
}
${S} .cm-completionDetail {
  color:#8aa0b8; font-style:italic; margin-left:.8em; opacity:.95;
}
${S} .cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail {
  color:#b8c7dc;
}
${S} .cm-completionInfo {
  background:#161b26; border:1px solid #2c3347; color:#b8c7dc;
  border-radius:8px; font-size:12px;
}
@media (max-width:700px) { ${S} .cm-completionInfo { display:none; } }
`;
    for (const [type, color] of Object.entries(AC_COLORS)) {
        css += `${S} .cm-completionIcon-${type} { color:${color}; }\n`;
        css += `${S} .cm-tooltip-autocomplete li:has(.cm-completionIcon-${type}) .cm-completionLabel { color:${color}; }\n`;
    }
    return css;
}

/** Aktifkan/matikan skop gaya sesuai file yang sedang dibuka. */
export function syncCompletionScope(): void {
    const f = g.editorManager?.activeFile;
    document.body.classList.toggle(AC_SCOPE, FILE_RE.test(f?.name ?? ""));
}

/** Pasang CSS popup berwarna; mengembalikan fungsi pembatalan. */
export function injectCompletionStyle(): () => void {
    let el = document.getElementById(AC_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement("style");
        el.id = AC_STYLE_ID;
        document.head.appendChild(el);
    }
    el.textContent = buildAcCss();
    syncCompletionScope();
    return () => {
        document.getElementById(AC_STYLE_ID)?.remove();
        document.body.classList.remove(AC_SCOPE);
    };
}
