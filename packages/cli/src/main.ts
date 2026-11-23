import { run } from "./cli";

const argv = process.argv.slice(2);
const { out, code } = run(argv);
if (code && argv.some((a) => a === "--human" || a === "-H")) console.error(out);
else console.log(out);
process.exitCode = code;
