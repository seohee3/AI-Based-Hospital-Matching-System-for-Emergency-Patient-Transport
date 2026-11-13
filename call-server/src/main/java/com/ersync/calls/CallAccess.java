package com.ersync.calls;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

/** Server-issued bearer keys for a single ambulance and separately provisioned hospitals. */
@Configuration
public class CallAccess implements WebMvcConfigurer {
    private final String ambulance;
    private final Map<String, String> hospitals = new HashMap<>();

    public CallAccess(@Value("${CALL_AMBULANCE_KEY}") String ambulance,
                      @Value("${CALL_HOSPITAL_KEYS:}") String entries) {
        validate(ambulance);
        this.ambulance = ambulance;
        if (entries.isBlank()) return;
        for (String entry : entries.split(",", -1)) {
            String[] pair = entry.trim().split("=", 2);
            if (pair.length != 2 || pair[0].isBlank()) throw invalid();
            validate(pair[1]);
            if (pair[1].equals(ambulance) || hospitals.containsValue(pair[1])
                    || hospitals.putIfAbsent(pair[0], pair[1]) != null) throw invalid();
        }
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("Check C server access key configuration");
    }

    private static void validate(String key) {
        if (!key.matches("[A-Za-z0-9_-]{32,128}")) throw invalid();
    }

    private static boolean matches(String key, String supplied) {
        return MessageDigest.isEqual(key.getBytes(StandardCharsets.US_ASCII),
                supplied.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(guard(false)).addPathPatterns("/api/calls", "/api/calls/**");
        registry.addInterceptor(guard(true)).addPathPatterns("/api/hospitals", "/api/hospitals/**");
    }

    private HandlerInterceptor guard(boolean hospital) {
        return new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
                res.setHeader("Cache-Control", "no-store");
                String header = req.getHeader("Authorization");
                if (header != null && header.startsWith("Bearer ")) {
                    String token = header.substring(7);
                    if (!hospital && matches(ambulance, token)) return true;
                    if (hospital) {
                        for (var entry : hospitals.entrySet()) {
                            if (matches(entry.getValue(), token)) {
                                req.setAttribute("hospitalId", entry.getKey());
                                return true;
                            }
                        }
                    }
                }
                res.setStatus(401);
                return false;
            }
        };
    }
}
