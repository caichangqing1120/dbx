// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import docsEn from "@/i18n/locales/docs/en";
import type { SchemaSnapshot } from "@/docs/types";
import DatabaseDocsDialog from "../DatabaseDocsDialog.vue";

const mocks = vi.hoisted(() => ({
  collect: vi.fn(),
  exportHtml: vi.fn(),
  exportPdf: vi.fn(),
}));

vi.mock("@/lib/backend/api", () => ({
  collectDocsSnapshot: mocks.collect,
  loadDocsAnnotations: vi.fn(async () => null),
  applyDocsAnnotations: vi.fn(async (_id, snapshot) => snapshot),
  exportDocsHtml: mocks.exportHtml,
}));
vi.mock("@/lib/export/mysqlDictionaryPdf", () => ({ saveMysqlDictionaryPdf: mocks.exportPdf }));
vi.mock("@/stores/connectionStore", () => ({ useConnectionStore: () => ({ diagramSource: null }) }));
vi.mock("@/docs/DocsApp.vue", () => ({ default: { render: () => null } }));
vi.mock("@/components/ui/dialog", async () => {
  const { h } = await import("vue");
  const section = {
    render(this: { $slots: { default?: () => unknown } }) {
      return h("section", this.$slots.default?.());
    },
  };
  return { Dialog: section, DialogContent: section, DialogHeader: section, DialogTitle: section };
});
vi.mock("@/components/ui/button", async () => {
  const { h } = await import("vue");
  return {
    Button: {
      render(this: { $attrs: Record<string, unknown>; $slots: { default?: () => unknown } }) {
        return h("button", this.$attrs, this.$slots.default?.());
      },
    },
  };
});

const base = {
  formatVersion: 1,
  project: { name: "demo", databaseType: "MySQL", database: "demo", schemas: [], generatedAt: "2026-09-20T00:00:00Z", note: null },
  tables: [],
  relationships: [],
  groups: [],
  enums: [],
  warnings: [],
} as SchemaSnapshot;

let app: ReturnType<typeof createApp> | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  app?.unmount();
  host?.remove();
  app = null;
  host = null;
  vi.clearAllMocks();
});

async function mount(snapshot: SchemaSnapshot): Promise<HTMLElement> {
  mocks.collect.mockResolvedValue(snapshot);
  mocks.exportHtml.mockResolvedValue(undefined);
  mocks.exportPdf.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.appendChild(host);
  app = createApp(DatabaseDocsDialog, { open: true, prefillConnectionId: "c1", prefillDatabase: "demo" });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: { docs: docsEn } } }));
  app.mount(host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  return host;
}

describe("database documentation export", () => {
  it("passes the selected language to both MySQL PDF and HTML exports", async () => {
    const root = await mount(base);
    const language = root.querySelector<HTMLSelectElement>('select[aria-label="Export language"]')!;
    expect(language.value).toBe("en");
    language.value = "tr";
    language.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();

    const buttons = [...root.querySelectorAll("button")];
    buttons.find((button) => button.textContent?.includes("PDF"))!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.exportPdf).toHaveBeenCalledWith(expect.objectContaining({ project: base.project }), "tr");

    buttons.find((button) => button.textContent?.includes("HTML"))!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.exportHtml).toHaveBeenCalledWith("demo-docs.html", expect.anything(), expect.anything(), "tr");
  });

  it("does not offer PDF for other database types", async () => {
    const root = await mount({ ...base, project: { ...base.project, databaseType: "PostgreSQL" } });
    expect(root.textContent).toContain("Export HTML");
    expect(root.textContent).not.toContain("Export PDF");
  });
});
