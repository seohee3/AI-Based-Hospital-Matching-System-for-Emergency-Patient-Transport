package com.ersync.calls;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.util.*;

import static org.springframework.http.HttpStatus.*;

@Service
public class CallService {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final ObjectWriter canonical;

    public CallService(JdbcTemplate db, ObjectMapper json) {
        this.db = db;
        this.json = json;
        this.canonical = json.writer().with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);
    }

    record Created(JsonNode detail, boolean created) {}
    private record Identity(String id, String hash) {}
    record ResponseResult(JsonNode detail, boolean conflict) {}

    private String lockCall(String id) {
        var states = db.queryForList("SELECT status FROM transport_call WHERE id=? FOR UPDATE", String.class, id);
        if (states.isEmpty()) throw new ResponseStatusException(NOT_FOUND, "call not found");
        return states.get(0);
    }

    @Transactional
    public ResponseResult cancel(String id) {
        String status = lockCall(id);
        if (!status.equals("PENDING")) return new ResponseResult(detail(id), !status.equals("CANCELLED"));
        db.update("UPDATE transport_call SET status='CANCELLED', finished_at=CURRENT_TIMESTAMP(3) WHERE id=?", id);
        db.update("UPDATE transport_call_hospital SET status='CANCELLED' WHERE call_id=? AND status='PENDING'", id);
        return new ResponseResult(detail(id), false);
    }

    @Transactional
    public Created retry(String id) {
        if (!lockCall(id).equals("ALL_DECLINED"))
            throw new ResponseStatusException(CONFLICT, "only an all-declined call can be retried");
        var children = db.queryForList("SELECT id FROM transport_call WHERE retry_of_call_id=?", String.class, id);
        if (!children.isEmpty()) return new Created(detail(children.get(0)), false);
        String child = UUID.randomUUID().toString();
        db.update("""
                INSERT INTO transport_call(id, request_key, request_hash, retry_of_call_id, report_snapshot, applied_radius_km)
                SELECT ?, CONCAT('retry/', id), SHA2(CONCAT('retry/', id), 256), id, report_snapshot, applied_radius_km
                FROM transport_call WHERE id=?
                """, child, id);
        db.update("""
                INSERT INTO transport_call_hospital(call_id, hpid, candidate_rank, hospital_snapshot)
                SELECT ?, hpid, candidate_rank, hospital_snapshot FROM transport_call_hospital WHERE call_id=?
                """, child, id);
        return new Created(detail(child), true);
    }

    @Transactional
    public ResponseResult respond(String id, String hpid, String decision) {
        require("ACCEPT".equals(decision) || "DECLINE".equals(decision), "expected ACCEPT or DECLINE");
        // Serialize all hospital decisions for one call, including those from other API instances.
        String status = lockCall(id);
        var candidates = db.queryForList("SELECT status FROM transport_call_hospital WHERE call_id=? AND hpid=?",
                String.class, id, hpid);
        if (candidates.isEmpty()) throw new ResponseStatusException(NOT_FOUND, "candidate not found");
        boolean accept = "ACCEPT".equals(decision);
        String response = accept ? "ACCEPTED" : "DECLINED";
        if (!"PENDING".equals(status) || !"PENDING".equals(candidates.get(0))) {
            return new ResponseResult(detail(id), !response.equals(candidates.get(0)));
        }
        db.update("""
                UPDATE transport_call_hospital SET status=?, responded_at=CURRENT_TIMESTAMP(3)
                WHERE call_id=? AND hpid=?
                """, response, id, hpid);
        if (accept) {
            db.update("""
                    UPDATE transport_call SET status='CONFIRMED', confirmed_hpid=?, finished_at=CURRENT_TIMESTAMP(3)
                    WHERE id=?
                    """, hpid, id);
            db.update("""
                    UPDATE transport_call_hospital SET status='CLOSED_BY_CONFIRMATION'
                    WHERE call_id=? AND status='PENDING'
                    """, id);
        } else {
            db.update("""
                    UPDATE transport_call SET status='ALL_DECLINED', finished_at=CURRENT_TIMESTAMP(3)
                    WHERE id=? AND NOT EXISTS (
                        SELECT 1 FROM transport_call_hospital WHERE call_id=? AND status='PENDING')
                    """, id, id);
        }
        return new ResponseResult(detail(id), false);
    }

    @Transactional
    public Created create(String key, JsonNode body) {
        require(key.matches("[A-Za-z0-9._:-]{1,128}"), "Idempotency-Key must be 1-128 ASCII key characters");
        var report = body.path("report");
        var ktas = report.path("ktas");
        require(report.isObject() && ktas.isIntegralNumber() && ktas.canConvertToInt()
                && ktas.intValue() >= 1 && ktas.intValue() <= 5, "report.ktas must be 1-5");
        var facilities = report.path("requiredFacilities");
        require(facilities.isArray(), "report.requiredFacilities must be an array");
        for (var facility : facilities) require(facility.isTextual(), "facility must be a string");
        var radius = body.path("appliedRadiusKm");
        require(radius.isIntegralNumber() && radius.canConvertToInt() && radius.intValue() > 0,
                "appliedRadiusKm must be a positive integer");
        var hospitals = body.path("hospitals");
        require(hospitals.isArray() && hospitals.size() >= 1 && hospitals.size() <= 3, "expected 1-3 hospitals");
        var ids = new HashSet<String>();
        for (var hospital : hospitals) {
            var id = hospital.path("hpid");
            require(id.isTextual() && !id.textValue().isBlank() && id.textValue().equals(id.textValue().strip())
                    && id.textValue().length() <= 64 && ids.add(id.textValue()), "invalid or duplicate hpid");
            var name = hospital.path("dutyName");
            require(name.isTextual() && !name.textValue().isBlank(), "dutyName is required");
        }

        String proposedId = UUID.randomUUID().toString();
        String hash = fingerprint(body);
        // A concurrent replay waits for the winning transaction on the unique request key.
        db.update("""
                INSERT INTO transport_call(id, request_key, request_hash, report_snapshot, applied_radius_km)
                VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = transport_call.id
                """, proposedId, key, hash, report.toString(), radius.intValue());
        var identity = db.queryForObject("SELECT id, request_hash FROM transport_call WHERE request_key=? FOR UPDATE",
                (rs, row) -> new Identity(rs.getString(1), rs.getString(2)), key);
        if (!identity.hash().equals(hash)) throw new ResponseStatusException(CONFLICT, "key already used for a different request");
        boolean created = proposedId.equals(identity.id());
        if (created) {
            for (int i = 0; i < hospitals.size(); i++) {
                var hospital = hospitals.get(i);
                db.update("""
                        INSERT INTO transport_call_hospital(call_id, hpid, candidate_rank, hospital_snapshot)
                        VALUES (?, ?, ?, ?)
                        """, proposedId, hospital.get("hpid").textValue(), i + 1, hospital.toString());
            }
        }
        return new Created(detail(identity.id()), created);
    }

    record Summary(String callId, String retryOfCallId, String status, String finishedAt,
                   int candidateCount, String confirmedHospitalName) {}
    record HistoryPage(List<Summary> records, String nextCursor) {}

    @Transactional(readOnly = true)
    public HistoryPage history(UUID cursor, int limit) {
        require(limit >= 1 && limit <= 100, "limit must be between 1 and 100");
        String sql = """
                SELECT c.id, c.retry_of_call_id, c.status, c.finished_at,
                       (SELECT COUNT(*) FROM transport_call_hospital h WHERE h.call_id=c.id) AS candidate_count,
                       w.hospital_snapshot->>'$.dutyName' AS winner
                FROM transport_call c
                LEFT JOIN transport_call_hospital w ON w.call_id=c.id AND w.hpid=c.confirmed_hpid
                WHERE c.status IN ('CONFIRMED','ALL_DECLINED','CANCELLED')
                """;
        List<Object> args = new ArrayList<>();
        if (cursor != null) {
            sql += " AND (c.finished_at,c.id) < (SELECT finished_at,id FROM transport_call WHERE id=?)";
            args.add(cursor.toString());
        }
        args.add(limit + 1);
        var rows = db.query(sql + " ORDER BY c.finished_at DESC,c.id DESC LIMIT ?", (rs, n) ->
                new Summary(rs.getString("id"), rs.getString("retry_of_call_id"), rs.getString("status"),
                        instant(rs.getTimestamp("finished_at")), rs.getInt("candidate_count"), rs.getString("winner")),
                args.toArray());
        if (rows.size() <= limit) return new HistoryPage(rows, null);
        return new HistoryPage(rows.subList(0, limit), rows.get(limit - 1).callId());
    }

    @Transactional(readOnly = true)
    public ObjectNode detail(String id) {
        var rows = db.query("SELECT * FROM transport_call WHERE id=?", (rs, n) -> {
            var call = json.createObjectNode();
            call.put("callId", rs.getString("id"));
            call.put("retryOfCallId", rs.getString("retry_of_call_id"));
            call.put("status", rs.getString("status"));
            call.set("report", parse(rs.getString("report_snapshot")));
            call.put("appliedRadiusKm", rs.getInt("applied_radius_km"));
            call.put("confirmedHpid", rs.getString("confirmed_hpid"));
            call.put("startedAt", instant(rs.getTimestamp("started_at")));
            call.put("finishedAt", instant(rs.getTimestamp("finished_at")));
            return call;
        }, id);
        if (rows.isEmpty()) throw new ResponseStatusException(NOT_FOUND, "call not found");
        var call = rows.get(0);
        var candidates = call.putArray("hospitals");
        db.query("SELECT * FROM transport_call_hospital WHERE call_id=? ORDER BY candidate_rank", rs -> {
            var hospital = (ObjectNode) parse(rs.getString("hospital_snapshot"));
            hospital.put("rank", rs.getInt("candidate_rank"));
            hospital.put("status", rs.getString("status"));
            hospital.put("respondedAt", instant(rs.getTimestamp("responded_at")));
            candidates.add(hospital);
        }, id);
        return call;
    }

    private String fingerprint(JsonNode body) {
        try {
            byte[] bytes = canonical.writeValueAsBytes(json.convertValue(body, Object.class));
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (JsonProcessingException | NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private JsonNode parse(String snapshot) {
        try { return json.readTree(snapshot); }
        catch (JsonProcessingException e) { throw new IllegalStateException("Invalid stored snapshot", e); }
    }

    private static String instant(Timestamp time) {
        return time == null ? null : time.toInstant().toString();
    }

    private static void require(boolean valid, String message) {
        if (!valid) throw new ResponseStatusException(BAD_REQUEST, message);
    }
}
