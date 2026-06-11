import {
  showToast,
  Toast,
  Clipboard,
  showHUD,
  getPreferenceValues,
} from "@raycast/api";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { runCommand } from "./utils/shell";

interface Preferences {
  solver: "claude" | "codex";
}

type Solver = Preferences["solver"];

const SOLVERS: Record<
  Solver,
  { binaryName: string; displayName: string; installHint: string }
> = {
  codex: {
    binaryName: "codex",
    displayName: "Codex",
    installHint:
      "Install the Codex CLI or choose Claude Code in the extension preferences.",
  },
  claude: {
    binaryName: "claude",
    displayName: "Claude",
    installHint:
      "Install the Claude Code CLI or choose Codex in the extension preferences.",
  },
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findExecutable(solver: Solver): Promise<string> {
  const { binaryName, displayName, installHint } = SOLVERS[solver];

  try {
    const { stdout } = await runCommand("zsh", [
      "-l",
      "-c",
      `command -v ${binaryName}`,
    ]);
    const resolvedPath = stdout.trim();
    if (resolvedPath && (await pathExists(resolvedPath))) {
      return resolvedPath;
    }
  } catch {
    // Fall back to common install locations below.
  }

  const homeDir = os.homedir();
  const candidatePaths = [
    path.join(homeDir, ".local", "bin", binaryName),
    path.join(homeDir, ".npm-global", "bin", binaryName),
    path.join(homeDir, ".yarn", "bin", binaryName),
    path.join(homeDir, ".bun", "bin", binaryName),
    `/opt/homebrew/bin/${binaryName}`,
    `/usr/local/bin/${binaryName}`,
  ];

  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    `${displayName} CLI was not found on your login-shell PATH. ${installHint}`,
  );
}

export default async function main() {
  const preferences = getPreferenceValues<Preferences>();
  const solver = preferences.solver || "codex";
  const solverConfig = SOLVERS[solver];

  const tempFilePath = path.join(
    os.tmpdir(),
    `raycast-screenshot-${Date.now()}.png`,
  );

  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Taking screenshot...",
    message: "Capturing full screen",
  });

  try {
    // Run macOS screencapture silent full screen mode
    await runCommand("screencapture", ["-x", tempFilePath]);

    // Check if the screenshot was actually created
    if (!fs.existsSync(tempFilePath)) {
      toast.style = Toast.Style.Failure;
      toast.title = "Screenshot failed";
      toast.message = "Could not capture full screen";
      return;
    }

    toast.title = `Solving with ${solverConfig.displayName}...`;
    toast.message = `Analyzing full screen and generating answer via ${solverConfig.displayName}`;

    const binaryPath = await findExecutable(solver);

    const prompt = `Solve the question in this screenshot: ${tempFilePath}. Output only the final answer as Python code. Do not include explanations, Markdown code fences, comments, labels, or any text outside the code. Do not run any commands or edit any files.`;

    let stdout = "";
    let stderr = "";
    try {
      if (solver === "claude") {
        // Run Claude CLI in non-interactive print mode with screenshot
        const result = await runCommand("zsh", [
          "-l",
          "-c",
          `"${binaryPath}" -p "$1" --dangerously-skip-permissions < /dev/null`,
          "--",
          prompt,
        ]);
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        // Run Codex CLI in non-interactive mode
        const result = await runCommand("zsh", [
          "-l",
          "-c",
          `"${binaryPath}" exec --skip-git-repo-check "$1" < /dev/null`,
          "--",
          prompt,
        ]);
        stdout = result.stdout;
        stderr = result.stderr;
      }
    } catch (error: unknown) {
      const err = error as Error & { stdout?: string; stderr?: string };
      const stdoutStr = err.stdout ? err.stdout.trim() : "";
      const stderrStr = err.stderr ? err.stderr.trim() : "";
      const combinedOutput = [stdoutStr, stderrStr].filter(Boolean).join("\n");
      const cleanError =
        combinedOutput ||
        err.message
          .replace(/^Failed to execute "[^"]+" \(exit code \d+\): /, "")
          .trim();

      // Copy the error message to clipboard so user knows why it failed
      await Clipboard.copy(cleanError);

      toast.style = Toast.Style.Failure;
      toast.title = "Failed to solve";
      toast.message = "Error copied to clipboard";
      await showHUD("Error copied to clipboard!");
      return;
    }

    if (!stdout.trim()) {
      throw new Error(
        stderr || `${solverConfig.displayName} returned an empty response.`,
      );
    }

    // Copy to clipboard
    await Clipboard.copy(stdout.trim());

    // Show success
    toast.style = Toast.Style.Success;
    toast.title = "Solved!";
    toast.message = "Answer copied to clipboard";

    await showHUD("Answer copied to clipboard!");
  } catch (error: unknown) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const stdoutStr = err.stdout ? err.stdout.trim() : "";
    const stderrStr = err.stderr ? err.stderr.trim() : "";
    const combinedOutput = [stdoutStr, stderrStr].filter(Boolean).join("\n");
    const cleanError =
      combinedOutput ||
      err.message
        .replace(/^Failed to execute "[^"]+" \(exit code \d+\): /, "")
        .trim();

    await Clipboard.copy(cleanError);

    toast.style = Toast.Style.Failure;
    toast.title = "Failed to solve screenshot";
    toast.message = "Error copied to clipboard";
    await showHUD("Error copied to clipboard!");
  } finally {
    // Clean up temporary screenshot file
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.error("Failed to clean up screenshot file:", e);
      }
    }
  }
}
