package com.ersync.calls;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;

@RestController
@RequestMapping("/api/calls")
public class CallController {
    private final CallService calls;

    private final boolean demoEnabled;

    public CallController(CallService calls, @org.springframework.beans.factory.annotation.Value("${CALL_DEMO_ENABLED:false}") boolean demoEnabled) {
        this.calls = calls;
        this.demoEnabled = demoEnabled;
    }

    @GetMapping("/access")
    public ResponseEntity<Void> access() { return ResponseEntity.noContent().build(); }

    @PostMapping
    public ResponseEntity<JsonNode> create(@RequestHeader("Idempotency-Key") String key,
                                           @RequestBody JsonNode body) {
        return created(calls.create(key, body));
    }

    @PostMapping("/{callId}/cancel")
    public ResponseEntity<JsonNode> cancel(@PathVariable String callId) {
        var result = calls.cancel(callId);
        return ResponseEntity.status(result.conflict() ? 409 : 200).body(result.detail());
    }

    @PostMapping("/{callId}/retry")
    public ResponseEntity<JsonNode> retry(@PathVariable String callId) {
        return created(calls.retry(callId));
    }

    private ResponseEntity<JsonNode> created(CallService.Created result) {
        URI location = URI.create("/api/calls/" + result.detail().get("callId").asText());
        return ResponseEntity.status(result.created() ? 201 : 200).location(location).body(result.detail());
    }

    @GetMapping(params = "status=terminal")
    public CallService.HistoryPage history(@RequestParam(required = false) java.util.UUID cursor,
                                           @RequestParam(defaultValue = "20") int limit) {
        return calls.history(cursor, limit);
    }

    @GetMapping("/{callId}")
    public JsonNode find(@PathVariable String callId) {
        return calls.detail(callId);
    }

    @PostMapping("/{callId}/demo/hospitals/{hpid}/response")
    public ResponseEntity<JsonNode> respond(@PathVariable String callId, @PathVariable String hpid,
                                           @RequestBody JsonNode body) {
        if (!demoEnabled) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN);
        var result = calls.respond(callId, hpid, body.path("decision").asText());
        return ResponseEntity.status(result.conflict() ? 409 : 200).body(result.detail());
    }
}
