package com.ersync.calls;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/hospitals/me")
public class HospitalController {
    private final HospitalQueries queries;
    private final CallService calls;

    public HospitalController(HospitalQueries queries, CallService calls) {
        this.queries = queries;
        this.calls = calls;
    }

    @GetMapping
    public HospitalQueries.Hospital identity(@RequestAttribute String hospitalId) {
        return queries.hospitals(hospitalId).stream().findFirst()
                .orElse(new HospitalQueries.Hospital(hospitalId, hospitalId));
    }

    @GetMapping("/requests")
    public List<HospitalQueries.Request> requests(@RequestAttribute String hospitalId) {
        return queries.requests(hospitalId);
    }

    record Decision(String decision) {}

    @PostMapping("/requests/{callId}/response")
    public ResponseEntity<Void> respond(@RequestAttribute String hospitalId, @PathVariable String callId,
                                        @RequestBody Decision decision) {
        var result = calls.respond(callId, hospitalId, decision.decision());
        return ResponseEntity.status(result.conflict() ? 409 : 204).build();
    }
}
