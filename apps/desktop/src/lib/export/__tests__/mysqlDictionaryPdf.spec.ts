import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SchemaSnapshot } from "@/docs/types";
import { buildMysqlDictionaryDefinition, MYSQL_DICTIONARY_LOCALES, renderMysqlDictionaryPdf } from "../mysqlDictionaryPdf";
import { LOCALE_OPTIONS } from "@/lib/app/localeOptions";

const snapshot: SchemaSnapshot = {
  formatVersion: 1,
  project: { name: "Example", databaseType: "MySQL", database: "demo", schemas: [], generatedAt: "2026-09-20T00:00:00Z", note: "Example schema note" },
  tables: [
    {
      schema: null,
      name: "orders",
      kind: "TABLE",
      note: "订单",
      noteSource: "DATABASE",
      shadowedNote: null,
      columns: [
        { name: "id", data_type: "bigint(20)", is_nullable: false, column_default: null, is_primary_key: true, extra: "auto_increment", comment: "订单ID", numeric_precision: 20, numeric_scale: 0, character_maximum_length: null },
        { name: "status", data_type: "varchar(30)", is_nullable: true, column_default: "new", is_primary_key: false, extra: null, comment: "状态", numeric_precision: null, numeric_scale: null, character_maximum_length: 30 },
      ],
      indexes: [{ name: "idx_status", columns: ["status"], is_unique: false, is_primary: false, index_type: "BTREE", filter: null, included_columns: null, comment: null }],
      foreignKeys: [{ name: "fk_orders_customer", column: "customer_id", ref_table: "customers", ref_column: "id", on_update: "CASCADE", on_delete: "RESTRICT" }],
      groupId: null,
      columnNotes: {},
      estimatedRows: null,
      viewDefinition: null,
    },
    {
      schema: null,
      name: "order_view",
      kind: "VIEW",
      note: null,
      noteSource: "NONE",
      shadowedNote: null,
      columns: [],
      indexes: [],
      foreignKeys: [],
      groupId: null,
      columnNotes: {},
      estimatedRows: null,
      viewDefinition: "SELECT id FROM orders",
    },
  ],
  relationships: [],
  groups: [],
  enums: [],
  warnings: [{ kind: "tableSkipped", table: "demo.secret", reason: "permission denied" }],
};

function reportText(value: unknown): string {
  if (Array.isArray(value)) return value.map(reportText).join("\n");
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  if (Array.isArray(node.text)) return node.text.map((part: { text: string }) => part.text).join("");
  return Object.values(node).map(reportText).join("\n");
}

describe("MySQL data dictionary PDF", () => {
  it("builds a cover, paginated contents, and schema sections without row data", () => {
    const definition = buildMysqlDictionaryDefinition(snapshot);
    const text = reportText(definition);
    expect(definition.pageSize).toBe("A4");
    expect(text).toContain("数据字典");
    expect(JSON.stringify(definition)).toContain('"toc"');
    expect(text).toContain("数据库: demo");
    expect(text).toContain("表: orders");
    expect(text).toContain("视图: order_view");
    expect(text).toContain("采集警告");
    expect(text).toContain("Example schema note");
    expect(text).toContain("SELECT id FROM orders");
    expect(text).toContain("demo.secret");
    expect(text).not.toContain("INSERT INTO");
  });

  it("preserves column order and MySQL metadata for fields, indexes and foreign keys", () => {
    const text = reportText(buildMysqlDictionaryDefinition(snapshot));
    expect(text.indexOf("订单ID")).toBeLessThan(text.indexOf("状态"));
    for (const value of ["bigint(20)", "varchar(30)", "auto_increment", "new", "idx_status", "BTREE", "fk_orders_customer", "CASCADE", "RESTRICT"]) {
      expect(text).toContain(value);
    }
  });

  it("rejects non-MySQL snapshots", () => {
    expect(() => buildMysqlDictionaryDefinition({ ...snapshot, project: { ...snapshot.project, databaseType: "PostgreSQL" } })).toThrow(/MySQL/);
  });

  it("offers every DBX language and translates report labels without translating schema metadata", () => {
    expect([...MYSQL_DICTIONARY_LOCALES].sort()).toEqual(LOCALE_OPTIONS.map((option) => option.value).sort());
    expect(reportText(buildMysqlDictionaryDefinition(snapshot, "ko"))).toContain("데이터 사전");
    expect(reportText(buildMysqlDictionaryDefinition(snapshot, "en"))).toContain("Data Dictionary");
    expect(reportText(buildMysqlDictionaryDefinition(snapshot, "ko"))).toContain("订单ID");
  });

  it("loads only the Latin font for an English report with ASCII metadata", async () => {
    const latin = readFileSync(new URL("../../../assets/fonts/NotoSans-Regular.ttf", import.meta.url));
    const fetchFont = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => latin.buffer.slice(latin.byteOffset, latin.byteOffset + latin.byteLength),
    }));
    vi.stubGlobal("fetch", fetchFont);
    try {
      await renderMysqlDictionaryPdf({ ...snapshot, tables: [], warnings: [] }, "en");
      expect(fetchFont).toHaveBeenCalledTimes(1);
      expect(fetchFont.mock.calls[0][0]).toContain("NotoSans-Regular.ttf");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("loads the Korean font for a Korean report without CJK metadata", async () => {
    const fonts = ["NotoSans-Regular.ttf", "NotoSansKR-Regular.otf"];
    const files = fonts.map((font) => readFileSync(new URL(`../../../assets/fonts/${font}`, import.meta.url)));
    const fetchFont = vi.fn(async (url: string) => {
      const index = fonts.findIndex((font) => url.includes(font));
      if (index === -1) throw new Error(`Unexpected font URL: ${url}`);
      const bytes = files[index];
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    });
    vi.stubGlobal("fetch", fetchFont);
    try {
      await renderMysqlDictionaryPdf({ ...snapshot, tables: [], warnings: [] }, "ko");
      expect(fetchFont).toHaveBeenCalledTimes(2);
      expect(fetchFont.mock.calls.map(([url]) => url)).toEqual(expect.arrayContaining([expect.stringContaining("NotoSans-Regular.ttf"), expect.stringContaining("NotoSansKR-Regular.otf")]));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("renders every DBX report language with only its required fonts", async () => {
    const fonts = ["NotoSans-Regular.ttf", "NotoSansSC-Regular.otf", "NotoSansKR-Regular.otf"];
    const files = fonts.map((font) => readFileSync(new URL(`../../../assets/fonts/${font}`, import.meta.url)));
    const fetchFont = vi.fn(async (url: string) => {
      const index = fonts.findIndex((font) => url.includes(font));
      if (index === -1) throw new Error(`Unexpected font URL: ${url}`);
      const bytes = files[index];
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    });
    vi.stubGlobal("fetch", fetchFont);
    try {
      const plain = { ...snapshot, tables: [], warnings: [] };
      for (const { value: lang } of LOCALE_OPTIONS) {
        fetchFont.mockClear();
        const pdf = await renderMysqlDictionaryPdf(plain, lang);
        expect(new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()).subarray(0, 5))).toBe("%PDF-");
        const expected = [fonts[0]];
        if (lang === "ko") expected.push(fonts[2]);
        if (lang === "ja" || lang === "zh-CN" || lang === "zh-TW") expected.push(fonts[1]);
        expect(fetchFont.mock.calls.map(([url]) => fonts.find((font) => url.includes(font)))).toEqual(expected);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);

  it("renders a searchable PDF with mixed Chinese, Japanese and Korean text", async () => {
    const fonts = ["NotoSans-Regular.ttf", "NotoSansSC-Regular.otf", "NotoSansKR-Regular.otf"];
    const files = fonts.map((font) => readFileSync(new URL(`../../../assets/fonts/${font}`, import.meta.url)));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const index = fonts.findIndex((font) => url.includes(font));
        if (index === -1) throw new Error(`Unexpected font URL: ${url}`);
        const bytes = files[index];
        return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      }),
    );
    try {
      const mixed = { ...snapshot, tables: snapshot.tables.map((table, index) => (index === 0 ? { ...table, note: "订单 テスト 테스트" } : table)) };
      const pdf = await renderMysqlDictionaryPdf(mixed, "ja");
      expect(fetch).toHaveBeenCalledTimes(3);
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(0, 8))).toMatch(/^%PDF-/);
      expect(bytes.length).toBeGreaterThan(1000);
      if (process.env.DBX_DICTIONARY_TEST_OUTPUT) writeFileSync(process.env.DBX_DICTIONARY_TEST_OUTPUT, bytes);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
