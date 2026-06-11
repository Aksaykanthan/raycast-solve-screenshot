import { execFile, ExecFileOptions } from "child_process";
import { promisify } from "util";

const execFilePromise = promisify(execFile);


/**
 * Executes a system binary safely with arguments as an array.
 * This avoids shell interpolation and shell injection vulnerabilities.
 *
 * @param file The binary or script file to run.
 * @param args The arguments array to pass.
 * @param options Additional ExecFileOptions.
 */
export async function runCommand(
  file: string,
  args: string[],
  options?: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFilePromise(file, args, options);
    return {
      stdout: stdout.toString().trim(),
      stderr: stderr.toString().trim(),
    };
  } catch (error: unknown) {
    const err = error as {
      message?: string;
      code?: number | string;
      stdout?: string;
      stderr?: string;
    };
    const message = err.message || String(error);
    const code = err.code !== undefined ? ` (exit code ${err.code})` : "";
    const newErr = new Error(
      `Failed to execute "${file}"${code}: ${message}`,
    ) as Error & {
      stdout?: string;
      stderr?: string;
    };
    newErr.stdout = err.stdout;
    newErr.stderr = err.stderr;
    throw newErr;
  }
}
