package com.ersync.calls;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/hospitals")
public class HospitalController {
    private final JdbcTemplate db;
    private final ObjectMapper json;

    public HospitalController(JdbcTemplate db, ObjectMapper json) {
        this.db = db;
        this.json = json;
    }

    record Hospital(String hpid, String name) {}
    record Request(String id, String retryOf, String startedAt, String respondedAt, String status,
                   JsonNode report, Integer eta) {}

    @GetMapping
    public List<Hospital> hospitals() {
        return db.query("""
                SELECT hpid, MAX(hospital_snapshot->>'$.dutyName') AS name
                FROM transport_call_hospital GROUP BY hpid ORDER BY name, hpid
                """, (rs, i) -> new Hospital(rs.getString("hpid"), rs.getString("name")));
    }

    @GetMapping("/{hpid}/requests")
    public List<Request> requests(@PathVariable String hpid) {
        return db.query("""
                SELECT c.id, c.retry_of_call_id, c.started_at, h.responded_at, h.status,
                       c.report_snapshot, h.hospital_snapshot
                FROM transport_call_hospital h JOIN transport_call c ON c.id=h.call_id
                WHERE h.hpid=? ORDER BY (h.status='PENDING') DESC, c.started_at DESC, c.id DESC
                """, (rs, i) -> {
            try {
                var hospital = json.readTree(rs.getString("hospital_snapshot"));
                var response = rs.getTimestamp("responded_at");
                var eta = hospital.path("etaMinutes");
                return new Request(rs.getString("id"), rs.getString("retry_of_call_id"),
                        rs.getTimestamp("started_at").toInstant().toString(),
                        response == null ? null : response.toInstant().toString(), rs.getString("status"),
                        json.readTree(rs.getString("report_snapshot")), eta.isNumber() ? eta.intValue() : null);
            } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
                throw new IllegalStateException("Invalid call snapshot", e);
            }
        }, hpid);
    }
}
