package com.ersync.controller;

import com.ersync.dto.LoginRequest;
import com.ersync.dto.LoginResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

/** A01 로그인 (시연용: 센터/사번/비밀번호가 비어 있지 않으면 통과) */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest req) {
        if (isBlank(req.center()) || isBlank(req.employeeId()) || isBlank(req.password())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "센터, 사번, 비밀번호를 모두 입력해 주세요.");
        }
        return new LoginResponse(UUID.randomUUID().toString(), "119 구급1팀", req.center().trim());
    }

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
