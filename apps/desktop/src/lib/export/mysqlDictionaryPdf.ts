import type { SchemaSnapshot, DocTable } from "@/docs/types";
import type { Locale } from "@/i18n";
import { createExportTranslate } from "@/docs-export/exportTranslate";
import { LOCALE_OPTIONS } from "@/lib/app/localeOptions";
import { isTauriRuntime } from "@/lib/backend/tauriRuntime";
import { dictionaryLabels } from "./mysqlDictionaryLabels";
import latinFontUrl from "@/assets/fonts/NotoSans-Regular.ttf?url";
import chineseFontUrl from "@/assets/fonts/NotoSansSC-Regular.otf?url";
import koreanFontUrl from "@/assets/fonts/NotoSansKR-Regular.otf?url";

export const MYSQL_DICTIONARY_LOCALES = LOCALE_OPTIONS.map((option) => option.value);

type PdfContent = Record<string, unknown>;

interface PdfDocumentDefinition {
  pageSize: "A4";
  pageMargins: [number, number, number, number];
  info: { title: string; subject: string };
  defaultStyle: PdfContent;
  styles: Record<string, PdfContent>;
  content: PdfContent[];
  footer: (page: number, count: number) => PdfContent;
}

interface PdfMakeBrowser {
  createPdf(definition: PdfDocumentDefinition, tableLayouts: undefined, fonts: Record<string, Record<string, string>>, vfs: Record<string, string>): { getBuffer(callback: (buffer: Uint8Array) => void): void };
}

// Database comments can mix scripts independently of the report language.
function runs(value: string): { text: string; font: string }[] {
  const result: { text: string; font: string }[] = [];
  for (const char of value || "-") {
    const code = char.codePointAt(0)!;
    const font = (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f) || (code >= 0xac00 && code <= 0xd7af) ? "NotoKR" : (code >= 0x3000 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) ? "NotoSC" : "NotoLatin";
    if (result.length && result[result.length - 1].font === font) result[result.length - 1].text += char;
    else result.push({ text: char, font });
  }
  return result;
}

function text(value: string, style?: string) {
  return { text: runs(value), ...(style ? { style } : {}) };
}

function grid(headers: string[], rows: string[][], widths: (number | "*")[]): PdfContent {
  const cell = (value: string) => ({ text: runs(value), margin: [2, 3, 2, 3] as [number, number, number, number] });
  return {
    table: { headerRows: 1, widths, body: [headers.map((header) => ({ ...cell(header), fillColor: "#e9eef2", bold: true })), ...rows.map((row) => row.map(cell))] },
    layout: { hLineColor: () => "#d6dce0", vLineColor: () => "#d6dce0", hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
    margin: [0, 5, 0, 13],
  };
}

function tableContents(table: DocTable, section: string, label: string, lang: Locale): PdfContent[] {
  const l = dictionaryLabels[lang];
  const translate = createExportTranslate(lang);
  const output: PdfContent[] = [{ ...text(`${section} ${label}: ${table.name}`, "objectTitle"), tocItem: true }];
  if (table.note) output.push(text(table.note, "note"));
  if (table.viewDefinition) {
    output.push(text(translate("docs.definitionHeader"), "heading"));
    output.push(text(table.viewDefinition, "note"));
  }
  if (table.columns.length) output.push(text(translate("docs.columns"), "heading"));
  const fieldRows = table.columns.map((column, index) => {
    const details = [column.is_primary_key ? l.primary : "", column.extra ?? "", column.column_default !== null ? `${l.defaultValue}: ${column.column_default}` : ""];
    const note = table.columnNotes[column.name]?.note ?? column.comment;
    return [String(index + 1), column.name, column.data_type, column.is_nullable ? "-" : "Y", [details.filter(Boolean).join("; "), note ?? ""].filter(Boolean).join("\n")];
  });
  if (fieldRows.length) output.push(grid([l.position, translate("docs.nameHeader"), translate("docs.typeHeader"), l.notNull, l.details], fieldRows, [28, 108, 88, 56, "*"]));

  if (table.indexes.length) {
    output.push(text(translate("docs.indexes"), "heading"));
    output.push(
      grid(
        [translate("docs.nameHeader"), l.indexKind, l.method, translate("docs.columns")],
        table.indexes.map((index) => [index.name, index.is_primary ? l.primary : index.is_unique ? l.unique : l.normal, index.index_type ?? "", index.columns.join(", ")]),
        [136, 80, 75, "*"],
      ),
    );
  }
  if (table.foreignKeys.length) {
    output.push(text(l.foreignKeys, "heading"));
    output.push(
      grid(
        [translate("docs.nameHeader"), translate("docs.columns"), translate("docs.references"), l.details],
        table.foreignKeys.map((fk) => [fk.name, fk.column, `${fk.ref_schema ? `${fk.ref_schema}.` : ""}${fk.ref_table}.${fk.ref_column}`, [fk.on_update ? `${l.onUpdate}: ${fk.on_update}` : "", fk.on_delete ? `${l.onDelete}: ${fk.on_delete}` : ""].filter(Boolean).join("; ")]),
        [115, 95, 130, "*"],
      ),
    );
  }
  return output;
}

export function buildMysqlDictionaryDefinition(snapshot: SchemaSnapshot, lang: Locale = "zh-CN"): PdfDocumentDefinition {
  if (snapshot.project.databaseType.toLowerCase() !== "mysql") throw new Error("MySQL snapshots only");
  const l = dictionaryLabels[lang];
  const database = snapshot.project.database ?? snapshot.project.name;
  const tables = snapshot.tables.filter((table) => table.kind === "TABLE");
  const views = snapshot.tables.filter((table) => table.kind === "VIEW" || table.kind === "MATERIALIZED_VIEW");
  const content: PdfContent[] = [
    { ...text(`${database} ${l.title}`, "cover"), margin: [0, 185, 0, 30] },
    { ...text(`${l.generatedAt}: ${snapshot.project.generatedAt}`, "coverDate"), pageBreak: "after" },
    { toc: { title: text(l.contents, "sectionTitle") }, pageBreak: "after" },
    text(l.introduction, "sectionTitle"),
    text(`MySQL · ${database} · ${tables.length} ${l.tables} · ${views.length} ${l.views}`, "note"),
    ...(snapshot.project.note ? [text(snapshot.project.note, "note")] : []),
    { ...text(`${l.database}: ${database}`, "sectionTitle"), tocItem: true, pageBreak: "before" },
  ];
  if (tables.length) {
    content.push(text(l.tables, "heading"));
    tables.forEach((table, index) => content.push(...tableContents(table, String(index + 1), l.table, lang)));
  }
  if (views.length) {
    content.push(text(l.views, "heading"));
    views.forEach((view, index) => content.push(...tableContents(view, String(index + 1), l.view, lang)));
  }
  if (snapshot.warnings.length) {
    content.push(text(l.warnings, "sectionTitle"));
    for (const warning of snapshot.warnings) {
      const detail = warning.kind === "tableSkipped" ? `${warning.table}: ${warning.reason}` : JSON.stringify(warning);
      content.push(text(detail, "note"));
    }
  }
  return {
    pageSize: "A4",
    pageMargins: [44, 48, 44, 55],
    info: { title: `${database} ${l.title}`, subject: "MySQL schema metadata" },
    defaultStyle: { font: "NotoLatin", fontSize: 9, color: "#202830", lineHeight: 1.25 },
    styles: {
      cover: { fontSize: 27, bold: true, alignment: "center", color: "#17242d" },
      coverDate: { fontSize: 10, alignment: "center", color: "#64727d" },
      sectionTitle: { fontSize: 15, bold: true, margin: [0, 5, 0, 14] },
      objectTitle: { fontSize: 12, bold: true, margin: [0, 18, 0, 6], color: "#17242d" },
      heading: { fontSize: 10, bold: true, margin: [0, 7, 0, 4] },
      note: { fontSize: 9, color: "#4c5a63", margin: [0, 0, 0, 8] },
    },
    content,
    footer: (page, count) => ({ text: `${database}  ·  ${page} / ${count}`, alignment: "right", margin: [44, 14, 44, 0], fontSize: 8, color: "#64727d" }),
  };
}

function base64(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(encoded);
}

const fontAssets = {
  NotoLatin: { file: "NotoSans-Regular.ttf", url: latinFontUrl },
  NotoSC: { file: "NotoSansSC-Regular.otf", url: chineseFontUrl },
  NotoKR: { file: "NotoSansKR-Regular.otf", url: koreanFontUrl },
} as const;

function requiredFonts(content: PdfContent[]): (keyof typeof fontAssets)[] {
  const fonts = new Set<keyof typeof fontAssets>(["NotoLatin"]);
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      if (node.font === "NotoSC" || node.font === "NotoKR") fonts.add(node.font);
      Object.values(node).forEach(visit);
    }
  }
  visit(content);
  return [...fonts];
}

export async function renderMysqlDictionaryPdf(snapshot: SchemaSnapshot, lang: Locale): Promise<Blob> {
  const definition = buildMysqlDictionaryDefinition(snapshot, lang);
  const [pdfMake, fontFiles] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    Promise.all(
      requiredFonts(definition.content).map(async (font) => {
        const { file, url } = fontAssets[font];
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Font unavailable: ${file}`);
        return [file, base64(new Uint8Array(await response.arrayBuffer()))] as const;
      }),
    ),
  ]);
  const vfs = Object.fromEntries(fontFiles);
  const fonts = {
    NotoLatin: { normal: fontAssets.NotoLatin.file, bold: fontAssets.NotoLatin.file, italics: fontAssets.NotoLatin.file, bolditalics: fontAssets.NotoLatin.file },
    NotoSC: { normal: fontAssets.NotoSC.file, bold: fontAssets.NotoSC.file, italics: fontAssets.NotoSC.file, bolditalics: fontAssets.NotoSC.file },
    NotoKR: { normal: fontAssets.NotoKR.file, bold: fontAssets.NotoKR.file, italics: fontAssets.NotoKR.file, bolditalics: fontAssets.NotoKR.file },
  };
  const builder = (pdfMake.default ?? pdfMake) as PdfMakeBrowser;
  const data = await new Promise<Uint8Array>((resolve, reject) => {
    try {
      builder.createPdf(definition, undefined, fonts, vfs).getBuffer((buffer) => resolve(new Uint8Array(buffer)));
    } catch (error) {
      reject(error);
    }
  });
  return new Blob([data.slice().buffer as ArrayBuffer], { type: "application/pdf" });
}

export async function saveMysqlDictionaryPdf(snapshot: SchemaSnapshot, lang: Locale): Promise<boolean> {
  const filename = `${snapshot.project.database ?? snapshot.project.name}-dictionary.pdf`;
  if (isTauriRuntime()) {
    const [{ save }, { writeFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
    const path = await save({ defaultPath: filename, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!path) return false;
    const pdf = await renderMysqlDictionaryPdf(snapshot, lang);
    await writeFile(path, new Uint8Array(await pdf.arrayBuffer()));
    return true;
  }
  const pdf = await renderMysqlDictionaryPdf(snapshot, lang);
  const url = URL.createObjectURL(pdf);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
