export function runCli(args: string[], write: (line: string) => void): number {
  if (args.includes("--version")) {
    write("0.0.0");
    return 0;
  }

  write("Software Factory CLI scaffold");
  return 0;
}
