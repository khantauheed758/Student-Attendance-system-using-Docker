import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const random = () => randomBytes(32).toString("hex");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const sign = (s: string, secret: string) =>
  createHmac("sha256", secret).update(s).digest("hex");
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const rate = (present: number, total: number) =>
  total ? Math.round((present / total) * 100) : 0;
export const attended = (s: string) => s === "PRESENT" || s === "LATE";
export const csv = (s: unknown) =>
  '"' +
  String(s ?? "")
    .replace(/^[=+@\-\t\r]/, "'$&")
    .replaceAll('"', '""') +
  '"';
