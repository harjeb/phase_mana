import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Apply only to an exact, clean checkout. Snapshot the patch so cleanup cannot
// accidentally reverse a different patch if its producer replaces the file.
export async function withTrackedPatch({ source, revision, patch }, build) {
  function git(args, input) {
    const result = spawnSync('git', args, {
      cwd: source, input, encoding: 'utf8', windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed (${result.signal ?? result.status}): ${result.stderr?.trim()}`);
    }
    return result.stdout.trim();
  }

  const head = git(['rev-parse', 'HEAD']);
  if (head !== revision) {
    throw new Error(`Worktree is at ${head}, expected ${revision}; refusing to reset it`);
  }
  if (git(['status', '--porcelain', '--untracked-files=all'])) {
    throw new Error(`Worktree has local changes: ${source}; refusing to build modified sources`);
  }
  const bytes = readFileSync(patch);
  git(['apply', '--check', '-'], bytes);
  // No --reject: git apply is atomic when any hunk fails.
  git(['apply', '-'], bytes);
  let buildError;
  try {
    return await build();
  } catch (error) {
    buildError = error;
    throw error;
  } finally {
    try {
      // Never reset/clean: unrelated edits and new files must survive. If an
      // overlapping edit prevents reversal, leave everything for manual review.
      git(['apply', '--reverse', '--check', '-'], bytes);
      git(['apply', '--reverse', '-'], bytes);
    } catch (error) {
      const cleanup = new Error(`Owned patch rollback failed in ${source}; changes left for manual review: ${error.message}`, { cause: error });
      if (buildError) {
        throw new AggregateError([buildError, cleanup], `${buildError.message}; ${cleanup.message}`);
      }
      throw cleanup;
    }
  }
}
