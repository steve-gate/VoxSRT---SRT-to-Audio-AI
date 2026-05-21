import { SrtSegment } from '../types';

export function parseSrt(srtContent: string): SrtSegment[] {
  const segments: SrtSegment[] = [];
  const transcriptBlocks = srtContent.trim().split(/\n\s*\n/);

  for (const block of transcriptBlocks) {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const id = parseInt(lines[0].trim());
      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
      if (timeMatch) {
        const startTime = timeMatch[1];
        const endTime = timeMatch[2];
        const text = lines.slice(2).join('\n').trim();

        segments.push({
          id,
          startTime,
          endTime,
          startTimeMs: timeToMs(startTime),
          endTimeMs: timeToMs(endTime),
          text,
        });
      }
    }
  }

  return segments;
}

function timeToMs(timeStr: string): number {
  const [h, m, sPart] = timeStr.split(':');
  const [s, ms] = sPart.split(',');
  return (
    parseInt(h) * 3600000 +
    parseInt(m) * 60000 +
    parseInt(s) * 1000 +
    parseInt(ms)
  );
}
