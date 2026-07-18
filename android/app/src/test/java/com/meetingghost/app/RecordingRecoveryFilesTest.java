package com.meetingghost.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import org.junit.Test;

public class RecordingRecoveryFilesTest {
    @Test
    public void coldRecoveryKeepsOnlyExactCompletedSegmentsAndDeletesEveryPartialForm() throws Exception {
        File directory = Files.createTempDirectory("meetingghost-recovery").toFile();
        try {
            Files.write(new File(directory, "seg-0").toPath(), new byte[] { 1, 2, 3 });
            Files.write(new File(directory, "seg-2").toPath(), new byte[] { 4, 5 });
            Files.write(new File(directory, "seg-1.partial").toPath(), new byte[] { 6 });
            Files.write(new File(directory, "seg-3.partial.import").toPath(), new byte[] { 7 });
            Files.write(new File(directory, "seg-4.partial.m4a").toPath(), new byte[] { 8 });
            Files.write(new File(directory, "seg-bad").toPath(), new byte[] { 9 });

            ArrayList<Integer> completed = RecordingRecoveryFiles.completedSegmentIds(directory);
            assertEquals(Arrays.asList(0, 2), completed);
            assertEquals(5, RecordingRecoveryFiles.totalBytes(directory, completed));

            RecordingRecoveryFiles.discardPartials(directory);
            assertTrue(new File(directory, "seg-0").exists());
            assertTrue(new File(directory, "seg-2").exists());
            assertFalse(new File(directory, "seg-1.partial").exists());
            assertFalse(new File(directory, "seg-3.partial.import").exists());
            assertFalse(new File(directory, "seg-4.partial.m4a").exists());
        } finally {
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) file.delete();
            directory.delete();
        }
    }

    @Test
    public void persistedFailedSegmentIdsAreNormalizedBeforeRecoveryStatusIsReturned() {
        assertEquals(
            Arrays.asList(1, 3),
            RecordingRecoveryFiles.parseSegmentIds("3,1,3,-1,bad")
        );
    }

    @Test
    public void coldServiceSnapshotRehydratesTheDurableManifestBeforeStop() throws Exception {
        File filesDirectory = Files.createTempDirectory("meetingghost-files").toFile();
        File recordingDirectory = new File(filesDirectory, "recordings/session_42");
        assertTrue(recordingDirectory.mkdirs());
        try {
            Files.write(new File(recordingDirectory, "seg-0").toPath(), new byte[] { 1, 2, 3 });
            Files.write(new File(recordingDirectory, "seg-2").toPath(), new byte[] { 4, 5 });
            Files.write(new File(recordingDirectory, "seg-3.partial").toPath(), new byte[] { 6 });

            RecordingRecoveryFiles.Snapshot snapshot = RecordingRecoveryFiles.restoreSnapshot(
                filesDirectory,
                "session_42",
                31_500,
                "1,1,bad"
            );

            assertEquals(recordingDirectory, snapshot.directory);
            assertEquals(Arrays.asList(0, 2), snapshot.segmentIds);
            assertEquals(Arrays.asList(1), snapshot.failedSegments);
            assertEquals(5, snapshot.totalBytes);
            assertEquals(31_500, snapshot.recordedMs);
            assertEquals(3, snapshot.nextSegment);
            assertFalse(new File(recordingDirectory, "seg-3.partial").exists());
        } finally {
            File[] recordings = recordingDirectory.listFiles();
            if (recordings != null) for (File file : recordings) file.delete();
            recordingDirectory.delete();
            File recordingsDirectory = new File(filesDirectory, "recordings");
            recordingsDirectory.delete();
            filesDirectory.delete();
        }
    }

    @Test
    public void recoverySnapshotRejectsUnsafeMeetingIdsWithoutReadingOutsideTheContainer() throws Exception {
        File filesDirectory = Files.createTempDirectory("meetingghost-safe-id").toFile();
        try {
            RecordingRecoveryFiles.Snapshot snapshot = RecordingRecoveryFiles.restoreSnapshot(
                filesDirectory,
                "../outside",
                -100,
                "4"
            );
            assertEquals(null, snapshot.directory);
            assertTrue(snapshot.segmentIds.isEmpty());
            assertEquals(Arrays.asList(4), snapshot.failedSegments);
            assertEquals(0, snapshot.totalBytes);
            assertEquals(0, snapshot.recordedMs);
            assertEquals(0, snapshot.nextSegment);
        } finally {
            filesDirectory.delete();
        }
    }
}
