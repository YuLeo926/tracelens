import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { FIRST_RUN_FEEDBACK_URL } from "./firstRun";

interface FormOption {
  label: string;
  required?: boolean;
}

interface FormField {
  type: string;
  id?: string;
  attributes?: {
    value?: string;
    description?: string;
    options?: Array<string | FormOption>;
  };
  validations?: { required?: boolean };
}

interface IssueForm {
  name: string;
  description: string;
  body: FormField[];
}

const formText = readFileSync(
  new URL("../../.github/ISSUE_TEMPLATE/first-run-feedback.yml", import.meta.url),
  "utf8",
);
const form = parse(formText) as IssueForm;
const byId = new Map<string, FormField>(
  form.body.flatMap((field) => (field.id ? [[field.id, field] as const] : [])),
);

describe("first-run feedback assets", () => {
  it("uses the dedicated GitHub issue form URL", () => {
    expect(FIRST_RUN_FEEDBACK_URL).toBe(
      "https://github.com/YuLeo926/tracelens/issues/new?template=first-run-feedback.yml",
    );
  });

  it("requires the fields needed to evaluate first-run success", () => {
    expect(form.name).toBe("First-run feedback");
    expect(form.description).toContain("first Codex analysis");
    for (const id of ["operating-system", "codex-surface", "setup", "session-selection", "analysis-useful", "reuse"]) {
      expect(byId.get(id)?.type).toBe("dropdown");
      expect(byId.get(id)?.validations?.required).toBe(true);
    }
  });

  it("warns that the issue is public and requires a privacy acknowledgement", () => {
    const markdown = form.body.find((field) => field.type === "markdown")?.attributes?.value ?? "";
    expect(markdown).toContain("public");
    expect(markdown).toContain("Do not include logs, local paths, secrets, private code, prompts, or conversation contents.");

    const privacy = byId.get("privacy");
    expect(privacy?.type).toBe("checkboxes");
    expect(privacy?.attributes?.options).toContainEqual({
      label: "I have not included private project or session data.",
      required: true,
    });
  });
});
