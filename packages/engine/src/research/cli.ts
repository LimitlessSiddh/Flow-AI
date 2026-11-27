import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResearchResult,
  buildPrompt,
  extractJson,
  type ResearchFacts,
  type ResearchProvider,
} from "./types.js";

/**
 * Research runs through a command-line agent installed on this computer, signed in with your own plan:
 *  - Claude Code (`claude`), included with Claude Pro
 *  - Codex CLI (`codex`), included with ChatGPT Plus
 * No API keys, no per-call billing.
 */
function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? new Error(`"${cmd}" is not installed or not on your PATH`)
          : e,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited with ${code}: ${err.slice(0, 300)}`));
    });
  });
}

export class ClaudeCodeProvider implements ResearchProvider {
  name = "Claude Code";
  constructor(private timeoutMs = 240_000) {}

  async research(facts: ResearchFacts, signal?: AbortSignal) {
    const out = await run(
      "claude",
      ["-p", buildPrompt(facts), "--output-format", "json", "--allowedTools", "WebSearch,WebFetch"],
      { timeoutMs: this.timeoutMs, signal },
    );
    const envelope = JSON.parse(out) as { result?: string; is_error?: boolean };
    if (envelope.is_error || typeof envelope.result !== "string")
      throw new Error("Claude Code returned an error");
    return ResearchResult.parse(extractJson(envelope.result));
  }
}

export class CodexProvider implements ResearchProvider {
  name = "Codex";
  constructor(private timeoutMs = 240_000) {}

  async research(facts: ResearchFacts, signal?: AbortSignal) {
    const dir = await mkdtemp(join(tmpdir(), "flow-codex-"));
    const file = join(dir, "last.txt");
    try {
      await run(
        "codex",
        [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--output-last-message",
          file,
          buildPrompt(facts),
        ],
        { timeoutMs: this.timeoutMs, signal },
      );
      return ResearchResult.parse(extractJson(await readFile(file, "utf8")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export function makeProvider(name: "claude" | "codex" | "off"): ResearchProvider | null {
  if (name === "claude") return new ClaudeCodeProvider();
  if (name === "codex") return new CodexProvider();
  return null;
}
