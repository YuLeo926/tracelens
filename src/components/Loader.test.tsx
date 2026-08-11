// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FIRST_RUN_FEEDBACK_URL } from "../core/firstRun";
import { ThemeProvider } from "../theme/ThemeProvider";
import { Loader } from "./Loader";

describe("Loader first-run feedback", () => {
  it("links to the opt-in public feedback form without interrupting the loader", () => {
    document.body.innerHTML = renderToStaticMarkup(
      <ThemeProvider>
        <Loader onLoad={vi.fn()} onError={vi.fn()} />
      </ThemeProvider>,
    );

    const link = document.querySelector<HTMLAnchorElement>("a[data-first-run-feedback]");
    expect(link?.textContent).toBe("First-run feedback");
    expect(link?.href).toBe(FIRST_RUN_FEEDBACK_URL);
    expect(link?.target).toBe("_blank");
    expect(link?.rel.split(" ")).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    expect(link?.classList).toContain("text-muted");
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });
});
