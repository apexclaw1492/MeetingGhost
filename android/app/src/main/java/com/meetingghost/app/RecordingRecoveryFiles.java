package com.meetingghost.app;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** Pure file helpers shared by live capture and cold-process recovery. */
final class RecordingRecoveryFiles {
    private RecordingRecoveryFiles() { }

    static final class Snapshot {
        final File directory;
        final ArrayList<Integer> segmentIds;
        final ArrayList<Integer> failedSegments;
        final long totalBytes;
        final long recordedMs;
        final int nextSegment;

        Snapshot(
            File directory,
            ArrayList<Integer> segmentIds,
            ArrayList<Integer> failedSegments,
            long totalBytes,
            long recordedMs,
            int nextSegment
        ) {
            this.directory = directory;
            this.segmentIds = segmentIds;
            this.failedSegments = failedSegments;
            this.totalBytes = totalBytes;
            this.recordedMs = recordedMs;
            this.nextSegment = nextSegment;
        }
    }

    static Snapshot restoreSnapshot(File filesDirectory, String meetingId, long recordedMs, String failedCsv) {
        ArrayList<Integer> failed = parseSegmentIds(failedCsv);
        if (filesDirectory == null || meetingId == null || !meetingId.matches("[A-Za-z0-9_-]+")) {
            return new Snapshot(null, new ArrayList<>(), failed, 0, Math.max(0, recordedMs), 0);
        }
        File directory = new File(filesDirectory, "recordings/" + meetingId);
        discardPartials(directory);
        ArrayList<Integer> completed = completedSegmentIds(directory);
        int next = completed.isEmpty() ? 0 : Collections.max(completed) + 1;
        return new Snapshot(
            directory,
            completed,
            failed,
            totalBytes(directory, completed),
            Math.max(0, recordedMs),
            next
        );
    }

    static ArrayList<Integer> completedSegmentIds(File directory) {
        ArrayList<Integer> result = new ArrayList<>();
        if (directory == null) return result;
        File[] files = directory.listFiles();
        if (files == null) return result;
        Set<Integer> unique = new HashSet<>();
        for (File file : files) {
            String name = file.getName();
            if (!name.matches("seg-[0-9]+")) continue;
            try { unique.add(Integer.parseInt(name.substring(4))); }
            catch (NumberFormatException ignored) { }
        }
        result.addAll(unique);
        Collections.sort(result);
        return result;
    }

    static ArrayList<Integer> parseSegmentIds(String value) {
        ArrayList<Integer> result = new ArrayList<>();
        if (value == null || value.isEmpty()) return result;
        Set<Integer> unique = new HashSet<>();
        for (String part : value.split(",")) {
            try {
                int parsed = Integer.parseInt(part);
                if (parsed >= 0) unique.add(parsed);
            } catch (NumberFormatException ignored) { }
        }
        result.addAll(unique);
        Collections.sort(result);
        return result;
    }

    static long totalBytes(File directory, ArrayList<Integer> segmentIds) {
        if (directory == null) return 0;
        long total = 0;
        for (int segment : segmentIds) {
            long size = new File(directory, "seg-" + segment).length();
            if (size > 0 && Long.MAX_VALUE - total >= size) total += size;
            else if (size > 0) return Long.MAX_VALUE;
        }
        return total;
    }

    static void discardPartials(File directory) {
        if (directory == null) return;
        File[] files = directory.listFiles((dir, name) -> name.contains(".partial"));
        if (files != null) for (File file : files) file.delete();
    }
}
