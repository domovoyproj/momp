import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
  markdownRehypePlugins,
  markdownRemarkPlugins,
  normalizeDisplayMath,
} from "./markdown.ts";

function renderMarkdown(markdown) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: markdownRemarkPlugins,
    rehypePlugins: markdownRehypePlugins,
  }, normalizeDisplayMath(markdown)));
}

describe("production Markdown dependency integration", () => {
  it("renders inline and display math with the upgraded KaTeX runtime", () => {
    const rendered = renderMarkdown("Inline $x^2$\n\n$$\\frac{a}{b}$$");
    assert.match(rendered, /class="katex"/);
    assert.match(rendered, /class="katex-display"/);
    assert.match(rendered, /<mfrac>/);
    assert.doesNotMatch(rendered, /katex-error/);
  });

  it("strips executable HTML and rejects untrusted math links", () => {
    const rendered = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n$\\href{javascript:alert(1)}{bad}$');
    assert.doesNotMatch(rendered, /<script|onerror=|href="javascript:/i);
    assert.match(rendered, /katex/);
  });

  it("keeps GFM tables and fenced Mermaid source intact", () => {
    const rendered = renderMarkdown("| A | B |\n| - | - |\n| 1 | 2 |\n\n```mermaid\nflowchart LR\nA --> B\n```");
    assert.match(rendered, /<table>/);
    assert.match(rendered, /language-mermaid/);
    assert.match(rendered, /A --&gt; B/);
  });
});
