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
  screenshotMode: "full" | "area";
  systemPrompt: string;
  showProgress: boolean;
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
  const screenshotMode = preferences.screenshotMode || "full";
  const showProgress = preferences.showProgress !== false;

  const tempFilePath = path.join(
    os.tmpdir(),
    `raycast-screenshot-${Date.now()}.png`,
  );

  // progress() only shows/mutates a toast when the preference is on;
  // errors always surface regardless of the setting.
  let toast: Toast | undefined;
  async function progress(
    style: Toast.Style,
    title: string,
    message?: string,
  ): Promise<void> {
    if (!showProgress) return;
    if (!toast) {
      toast = await showToast({ style, title, message });
    } else {
      toast.style = style;
      toast.title = title;
      toast.message = message;
    }
  }
  async function failToast(title: string, message: string): Promise<void> {
    if (toast) {
      toast.style = Toast.Style.Failure;
      toast.title = title;
      toast.message = message;
    } else {
      await showToast({ style: Toast.Style.Failure, title, message });
    }
  }

  const modeLabel =
    screenshotMode === "area" ? "Select area to capture" : "Capturing full screen";
  await progress(Toast.Style.Animated, "Taking screenshot...", modeLabel);

  try {
    const captureArgs =
      screenshotMode === "area"
        ? ["-ix", tempFilePath]  // interactive region selection, no shutter sound
        : ["-x", tempFilePath];  // full screen, no shutter sound

    await runCommand("screencapture", captureArgs);

    // Check if the screenshot was actually created (user may cancel area selection)
    if (!fs.existsSync(tempFilePath)) {
      await failToast(
        "Screenshot cancelled",
        screenshotMode === "area" ? "No area was selected" : "Could not capture full screen",
      );
      return;
    }

    await progress(
      Toast.Style.Animated,
      `Solving with ${solverConfig.displayName}...`,
      `Analysing screenshot via ${solverConfig.displayName}`,
    );

    const binaryPath = await findExecutable(solver);

    const DEFAULT_PROMPT =
      "Solve the question in this screenshot and output only the final answer as Python code. Do not include explanations, Markdown code fences, comments, labels, or any text outside the code.";

    const userPrompt = preferences.systemPrompt?.trim() || DEFAULT_PROMPT;
    const prompt = `${userPrompt}\n\nScreenshot path: ${tempFilePath}\n\nDo not run any commands or edit any files.`;

    let stdout = "";
    let stderr = "";
    try {
      if (solver === "claude") {
        // Run Claude directly — no intermediate shell so HOME is never overridden,
        // which lets claude find its credentials in ~/.claude.json.
        const result = await runCommand(
          binaryPath,
          ["-p", "--dangerously-skip-permissions", prompt],
          { env: { ...process.env, HOME: os.homedir() } },
        );
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

      await Clipboard.copy(cleanError);
      await failToast("Failed to solve", "Error copied to clipboard");
      await showHUD("Error copied to clipboard!");
      return;
    }

    // Auth errors surface as stdout text rather than a non-zero exit, so
    // catch them before treating the output as a valid answer.
    const notLoggedIn = /not logged in|please run.*\/login/i;
    if (notLoggedIn.test(stdout) || notLoggedIn.test(stderr)) {
      throw new Error(
        `Claude Code is not authenticated. Open a terminal and run: claude login`,
      );
    }

    if (!stdout.trim()) {
      throw new Error(
        stderr || `${solverConfig.displayName} returned an empty response.`,
      );
    }

    await Clipboard.copy(stdout.trim());

    await progress(Toast.Style.Success, "Solved!", "Answer copied to clipboard");
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
    await failToast("Failed to solve screenshot", "Error copied to clipboard");
    await showHUD("Error copied to clipboard!");
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.error("Failed to clean up screenshot file:", e);
      }
    }
  }
}
