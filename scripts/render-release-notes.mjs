import { readFile, writeFile } from "node:fs/promises";
import { posix, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function repositoryPath(value) {
  if (!value || value.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(value)) throw new Error("Expected a repository-relative path");
  const normalized = posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || normalized === ".") throw new Error("Link leaves the repository");
  return normalized;
}

function encodedSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, character => "%" + character.charCodeAt(0).toString(16).toUpperCase());
}

/** Render repository links for a GitHub Release without changing the source notes. */
export function renderReleaseNotes(markdown, { inputPath, serverUrl, repository, commit }) {
  const server = new URL(serverUrl);
  if (server.protocol !== "https:" || server.username || server.password || server.pathname !== "/" || server.search || server.hash) {
    throw new Error("GITHUB_SERVER_URL must be an HTTPS origin");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split("/").some(part => part === "." || part === "..")) {
    throw new Error("Invalid GITHUB_REPOSITORY");
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit)) throw new Error("VERIFIED_COMMIT must be a full commit SHA");
  const source = repositoryPath(inputPath);
  const prefix = server.origin + "/" + repository + "/blob/" + commit + "/";
  const targetUrl = target => {
    if (!target || target.startsWith("#") || target.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return target;
    const suffixIndex = target.search(/[?#]/);
    const rawPath = suffixIndex < 0 ? target : target.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? "" : target.slice(suffixIndex);
    let decoded;
    try { decoded = decodeURIComponent(rawPath.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~])/g, "$1")); }
    catch { throw new Error("Invalid percent encoding in release link"); }
    if (/[\\\u0000-\u001f\u007f]/.test(decoded + suffix)) throw new Error("Invalid release link path");
    const path = rawPath === "" ? source : repositoryPath(decoded.startsWith("/")
      ? decoded.slice(1) : posix.join(posix.dirname(source), decoded));
    return prefix + path.split("/").map(encodedSegment).join("/")
      + suffix.replace(/[ ()<>\[\]]/g, encodedSegment);
  };
  const destination = body => {
    const trimmed = body.trim();
    if (trimmed.startsWith("<")) {
      const end = trimmed.indexOf(">");
      if (end < 0) return body;
      return "<" + targetUrl(trimmed.slice(1, end)) + ">" + trimmed.slice(end + 1);
    }
    const title = /^(.*?)(\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))$/.exec(trimmed);
    return targetUrl(title ? title[1] : trimmed) + (title?.[2] ?? "");
  };
  const rewriteInline = line => {
    let output = "", start = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "`") {
        const ticks = /^`+/.exec(line.slice(i))[0];
        const end = line.indexOf(ticks, i + ticks.length);
        if (end >= 0) { i = end + ticks.length - 1; continue; }
      }
      if (line[i] !== "]" || line[i + 1] !== "(") continue;
      let depth = 1, angle = false, quote;
      let end = i + 2;
      for (; end < line.length; end++) {
        const char = line[end];
        if (char === "\\") { end++; continue; }
        if (quote) { if (char === quote) quote = undefined; continue; }
        if (angle) { if (char === ">") angle = false; continue; }
        if (char === "<") { angle = true; continue; }
        if ((char === '"' || char === "'") && /\s/.test(line[end - 1])) { quote = char; continue; }
        if (char === "(") depth++;
        if (char === ")" && --depth === 0) break;
      }
      if (depth !== 0) continue;
      output += line.slice(start, i + 2) + destination(line.slice(i + 2, end)) + ")";
      start = end + 1;
      i = end;
    }
    return output + line.slice(start);
  };
  let fence;
  return markdown.split(/(\r?\n)/).map(line => {
    if (/^\r?\n$/.test(line)) return line;
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (delimiter?.[0] === fence[0] && delimiter.length >= fence.length && /^\s*$/.test(line.slice(line.indexOf(delimiter) + delimiter.length))) fence = undefined;
      return line;
    }
    if (delimiter) { fence = delimiter; return line; }
    if (/^(?: {4}|\t)/.test(line)) return line;
    const definition = /^( {0,3}\[[^\]]+\]:\s*)(.+)$/.exec(line);
    return definition ? definition[1] + destination(definition[2]) : rewriteInline(line);
  }).join("");
}

async function main() {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error("Usage: node scripts/render-release-notes.mjs INPUT OUTPUT");
  const inputPath = repositoryPath(relative(process.cwd(), resolve(input)).replaceAll("\\", "/"));
  repositoryPath(relative(process.cwd(), resolve(output)).replaceAll("\\", "/"));
  if (resolve(input) === resolve(output)) throw new Error("Rendered notes must not overwrite their source");
  const rendered = renderReleaseNotes(await readFile(input, "utf8"), {
    inputPath, serverUrl: process.env.GITHUB_SERVER_URL, repository: process.env.GITHUB_REPOSITORY, commit: process.env.VERIFIED_COMMIT,
  });
  await writeFile(output, rendered, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
