// Sequential Reviewer — implement-then-review loop
//
// This template drives a two-phase workflow per issue:
//   Phase 1 (Implement): A sonnet agent picks an open issue, works on it,
//                        commits the changes together with the closed ticket,
//                        and signals completion.
//   Phase 2 (Review):    A second sonnet agent reviews that iteration's diff and
//                        either approves it or makes corrections on the branch.
//
// The issues are the local tickets in .scratch/ (read and closed with
// `npm run tickets`), so closing one is a commit, not a call to a remote
// tracker. That is why the whole run shares one sandbox and one branch: each
// iteration starts from the previous one's commits and sees which tickets are
// already done. The host's current branch is never touched; review the run's
// branch and merge it yourself.
//
// The loop repeats up to MAX_ITERATIONS times, processing one issue per
// iteration and stopping early once the backlog is exhausted (an implement
// phase that produces no commits).
//
// Usage:
//   npm run afk          # up to DEFAULT_MAX_ITERATIONS issues
//   npm run afk -- 2     # up to 2 issues
//
// The run's commits land on a new branch, afk/<timestamp>; merging it into
// main is a human's job.

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Maximum number of implement→review cycles to run before stopping.
// Each cycle works on one issue. The run's first argument overrides it
// (`npm run afk -- 2`).
const DEFAULT_MAX_ITERATIONS = 10;

const maxIterationsArg = process.argv[2];
const MAX_ITERATIONS =
  maxIterationsArg === undefined
    ? DEFAULT_MAX_ITERATIONS
    : Number(maxIterationsArg);
if (!Number.isInteger(MAX_ITERATIONS) || MAX_ITERATIONS < 1) {
  throw new Error(
    `Expected a positive whole number of issues, got "${String(maxIterationsArg)}". Usage: npm run afk -- <issues>`,
  );
}

// Hooks run inside the sandbox once, when it is created.
// npm install ensures the sandbox has fresh dependencies (and, through the
// `prepare` script, the git hooks that gate every commit). --no-save keeps the
// image's npm from rewriting package-lock.json: a dirty worktree is preserved
// on close instead of removed, so every run would leave its worktree behind.
const hooks = {
  sandbox: { onSandboxReady: [{ command: "npm install --no-save" }] },
};

// Copy node_modules from the host into the worktree before the sandbox
// starts. Avoids a full npm install from scratch; the hook above handles
// platform-specific binaries and any packages added since the last copy.
const copyToWorktree = ["node_modules"];

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

const branch = `afk/${String(Date.now())}`;

const sandbox = await sandcastle.createSandbox({
  branch,
  sandbox: docker(),
  hooks,
  copyToWorktree,
});

let completed = 0;

try {
  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(
      `\n=== Iteration ${String(iteration)}/${String(MAX_ITERATIONS)} ===\n`,
    );

    // Where this iteration starts, so the reviewer sees only its own diff.
    const head = await sandbox.exec("git rev-parse HEAD");
    if (head.exitCode !== 0) throw new Error(`git rev-parse: ${head.stderr}`);
    const base = head.stdout.trim();

    // -----------------------------------------------------------------------
    // Phase 1: Implement
    //
    // A sonnet agent picks the next open issue, writes the
    // implementation (using RGR: Red → Green → Repeat → Refactor), closes
    // the ticket and commits the result.
    //
    // The agent signals completion via <promise>COMPLETE</promise> when done.
    // -----------------------------------------------------------------------
    // One iteration so each outer pass implements a single issue, then hands
    // it to the reviewer. A higher value lets the agent drain the whole
    // backlog in a single pass, which defeats the per-issue review.
    const implement = await sandbox.run({
      name: "implementer",
      maxIterations: 1,
      agent: sandcastle.claudeCode("claude-sonnet-5-5"),
      promptFile: "./.sandcastle/implement-prompt.md",
    });

    if (!implement.commits.length) {
      // No commits means the backlog is empty or every remaining issue is
      // blocked — there is nothing left to implement or review, so stop.
      console.log("Implementation agent made no commits. Stopping.");
      break;
    }

    console.log(`\nImplementation complete on branch: ${branch}`);
    console.log(`Commits: ${String(implement.commits.length)}`);

    // -----------------------------------------------------------------------
    // Phase 2: Review
    //
    // A second sonnet agent reviews the commits made since {{BASE}} on
    // {{BRANCH}}, and either approves or makes corrections on the branch.
    // -----------------------------------------------------------------------
    await sandbox.run({
      name: "reviewer",
      maxIterations: 1,
      agent: sandcastle.claudeCode("claude-sonnet-5-5"),
      promptFile: "./.sandcastle/review-prompt.md",
      promptArgs: {
        BRANCH: branch,
        BASE: base,
      },
    });

    completed++;
    console.log("\nReview complete.");
  }
} finally {
  await sandbox.close();
}

console.log(
  completed > 0
    ? `\nAll done: ${String(completed)} issue(s) on ${branch}. Review it and merge it into your branch.`
    : "\nAll done: no issue was ready.",
);
