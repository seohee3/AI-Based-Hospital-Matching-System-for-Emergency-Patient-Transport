package com.ersync.service;

import com.ersync.dto.ReportDraft;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@Service
public class GroqService {

    private static final String SYSTEM_PROMPT = """
            너는 119 구급대원의 현장 음성 브리핑(음성 인식 결과 텍스트)을 응급실 전달용 보고서 항목으로 정리하는 도우미다.
            반드시 아래 JSON 객체 하나만 출력한다. 설명, 마크다운, 코드블록은 쓰지 않는다.

            {
              "age": "예: 65세 (언급 없으면 빈 문자열)",
              "sex": "남성 | 여성 | 미상",
              "chiefComplaints": ["핵심 증상을 짧은 명사형으로, 예: 흉통, 식은땀"],
              "bloodPressure": "수축기/이완기 형태, 예: 150/90 (언급 없으면 빈 문자열)",
              "consciousness": "명료 | 기면 | 혼미 | 혼수 | 미상",
              "requiredFacilities": ["필수 의료시설 목록"]
            }

            규칙:
            - 말한 내용에 근거해서만 채우고, 없는 사실을 지어내지 않는다.
            - "혈압 150에 90" 같은 말은 "150/90"으로 변환한다.
            - 의식 상태는 위 네 가지 중 하나로 매핑한다. 언급이 없으면 "미상".
            - requiredFacilities 는 반드시 아래 3개 중에서만, 환자 상태에 꼭 필요한 것만 고른다(필요 없으면 빈 배열):
              중환자실, 응급수술실, 심혈관센터
            - KTAS 등급은 판단하지 않는다(대원이 직접 선택한다).
            """;

    private final RestClient client;
    private final ObjectMapper mapper;
    private final String sttModel;
    private final String llmModel;

    public GroqService(@Value("${groq.api-key}") String apiKey,
                       @Value("${groq.base-url}") String baseUrl,
                       @Value("${groq.stt-model}") String sttModel,
                       @Value("${groq.llm-model}") String llmModel,
                       ObjectMapper mapper) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(90_000);
        this.client = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
                .build();
        this.mapper = mapper;
        this.sttModel = sttModel;
        this.llmModel = llmModel;
    }

    /** 녹음 → 텍스트 (whisper-large-v3-turbo) */
    public String transcribe(byte[] audio, String filename) {
        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        form.add("file", new ByteArrayResource(audio) {
            @Override
            public String getFilename() {
                return filename;
            }
        });
        form.add("model", sttModel);
        form.add("language", "ko");
        form.add("temperature", "0");
        form.add("response_format", "json");
        form.add("prompt", "119 구급 현장 브리핑. 환자 나이, 성별, 흉통, 식은땀, 혈압, 의식 상태, 호흡곤란, 심근경색, 뇌졸중.");

        try {
            String body = client.post()
                    .uri("/audio/transcriptions")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(form)
                    .retrieve()
                    .body(String.class);
            return mapper.readTree(body).path("text").asText("").trim();
        } catch (RestClientResponseException e) {
            throw groqError("음성 변환", e);
        } catch (RestClientException | IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "음성 변환 실패: " + e.getMessage());
        }
    }

    /** 텍스트 → 보고서 항목 (openai/gpt-oss-120b) */
    public ReportDraft draftReport(String transcript) {
        Map<String, Object> req = Map.of(
                "model", llmModel,
                "temperature", 0.2,
                "reasoning_effort", "low",
                "max_completion_tokens", 4000,
                "response_format", Map.of("type", "json_object"),
                "messages", List.of(
                        Map.of("role", "system", "content", SYSTEM_PROMPT),
                        Map.of("role", "user", "content", transcript)));
        try {
            String body = client.post()
                    .uri("/chat/completions")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(req)
                    .retrieve()
                    .body(String.class);
            String content = mapper.readTree(body).path("choices").path(0).path("message").path("content").asText("");
            return mapper.treeToValue(extractJson(content), ReportDraft.class);
        } catch (RestClientResponseException e) {
            throw groqError("보고서 정리", e);
        } catch (RestClientException | IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "보고서 정리 실패: " + e.getMessage());
        }
    }

    /** 모델이 코드블록 등을 섞어 보냈을 때를 대비해 첫 { ~ 마지막 } 만 파싱 */
    private JsonNode extractJson(String text) throws IOException {
        int s = text.indexOf('{');
        int e = text.lastIndexOf('}');
        if (s < 0 || e <= s) {
            throw new IOException("AI 응답에서 JSON을 찾지 못했습니다.");
        }
        return mapper.readTree(text.substring(s, e + 1));
    }

    private ResponseStatusException groqError(String step, RestClientResponseException e) {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                step + " 실패 (Groq " + e.getStatusCode().value() + "): " + e.getResponseBodyAsString());
    }
}
