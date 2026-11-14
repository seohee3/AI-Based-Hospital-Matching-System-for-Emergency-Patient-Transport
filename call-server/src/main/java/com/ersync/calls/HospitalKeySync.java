package com.ersync.calls;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.UUID;

@Component
@EnableScheduling
public class HospitalKeySync {
    private static final Logger log = LoggerFactory.getLogger(HospitalKeySync.class);
    private final JdbcTemplate db;
    private final Path file;
    private final String ambulance;

    public HospitalKeySync(JdbcTemplate db, @Value("${CALL_HOSPITAL_KEY_FILE:}") String file,
                           @Value("${CALL_AMBULANCE_KEY}") String ambulance) {
        this.db = db;
        this.file = file.isBlank() ? null : Path.of(file).toAbsolutePath();
        this.ambulance = ambulance;
    }

    @Scheduled(fixedDelay = 3000)
    public void sync() {
        if (file == null) return;
        try (var channel = FileChannel.open(Path.of(file + ".lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
             var lock = channel.tryLock()) {
            if (lock == null) return;
            var lines = Files.readAllLines(file);
            var keys = CallAccess.parseHospitalKeys(lines, ambulance);
            int originalSize = keys.size();
            db.query("""
                    SELECT hpid, MAX(hospital_snapshot->>'$.dutyName') AS name
                    FROM transport_call_hospital GROUP BY hpid ORDER BY hpid
                    """, (org.springframework.jdbc.core.RowCallbackHandler) row -> {
                String id = row.getString("hpid");
                if (keys.containsKey(id) || !id.matches("[A-Za-z0-9_-]{1,64}")) return;
                String name = row.getString("name").replaceAll("[\\p{C}\\s]+", " ").replace("/", "／").strip();
                String token;
                do { token = UUID.randomUUID().toString().replace("-", ""); }
                while (token.equals(ambulance) || keys.containsValue(token));
                keys.put(id, token);
                lines.add(name + " / " + id + " / " + token);
            });
            if (keys.size() == originalSize) return;
            var temp = Files.createTempFile(file.getParent(), ".hospital-keys-", ".tmp");
            try {
                Files.write(temp, lines);
                Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } finally {
                Files.deleteIfExists(temp);
            }
        } catch (Exception e) {
            // Do not log credentials, candidate names or raw DB output.
            log.warn("Hospital key sync will retry ({})", e.getClass().getSimpleName());
        }
    }
}
