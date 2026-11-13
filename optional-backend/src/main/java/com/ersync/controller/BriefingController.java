package com.ersync.controller;

import com.ersync.dto.ReportDraft;
import com.ersync.dto.TranscriptRequest;
import com.ersync.dto.TranscriptResponse;
import com.ersync.service.GroqService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;

/** A02 음성 브리핑. 보고서는 서버에 저장하지 않는다(요청-응답으로 끝). */
@RestController
@RequestMapping("/api/briefing")
public class BriefingController {

    private final GroqService groq;

    public BriefingController(GroqService groq) {
        this.groq = groq;
    }

    @PostMapping("/transcribe")
    public TranscriptResponse transcribe(@RequestParam("audio") MultipartFile audio) throws IOException {
        if (audio.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "녹음 파일이 비어 있습니다.");
        }
        String name = audio.getOriginalFilename() == null ? "briefing.m4a" : audio.getOriginalFilename();
        return new TranscriptResponse(groq.transcribe(audio.getBytes(), name));
    }

    @PostMapping("/report")
    public ReportDraft report(@RequestBody TranscriptRequest req) {
        if (req.transcript() == null || req.transcript().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "변환된 텍스트가 없습니다.");
        }
        return groq.draftReport(req.transcript());
    }
}
