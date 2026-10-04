import { attended, rate } from './security.js';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'EXCUSED';
export type SessionTiming = { startedAt: Date; endsAt: Date; closedAt: Date | null };
export function completed(session: SessionTiming, now = new Date()) {
  return session.closedAt !== null || session.endsAt <= now;
}
export function eligible(session: SessionTiming, enrolledAt: Date) {
  return enrolledAt <= session.startedAt;
}
export function effectiveStatus(session: SessionTiming, status?: AttendanceStatus, now = new Date()) {
  return status ?? (completed(session, now) ? 'ABSENT' : 'UNMARKED');
}
export function stats(statuses: AttendanceStatus[]) {
  const total = statuses.filter(s => s !== 'EXCUSED').length;
  const present = statuses.filter(attended).length;
  return { total, present, rate: rate(present, total) };
}
export function streak(statusesNewestFirst: AttendanceStatus[]) {
  let n = 0;
  for (const status of statusesNewestFirst) {
    if (status === 'EXCUSED') continue;
    if (!attended(status)) break;
    n++;
  }
  return n;
}
export function dayStatus(statuses: AttendanceStatus[]): AttendanceStatus {
  return (['ABSENT', 'PRESENT', 'EXCUSED'] as const).find(s => statuses.includes(s)) ?? 'EXCUSED';
}
