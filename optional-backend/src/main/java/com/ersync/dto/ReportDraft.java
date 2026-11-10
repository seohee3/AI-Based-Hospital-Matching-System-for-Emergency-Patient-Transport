package com.ersync.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/** AI가 음성 텍스트에서 정리한 보고서 초안. KTAS 등급은 AI가 아니라 대원이 직접 선택한다. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ReportDraft(
        String age,
        String sex,
        List<String> chiefComplaints,
        String bloodPressure,
        String consciousness,
        List<String> requiredFacilities,
        String specialNotes) {

    public ReportDraft {
        age = age == null ? "" : age.trim();
        sex = sex == null ? "" : sex.trim();
        chiefComplaints = chiefComplaints == null ? List.of() : chiefComplaints;
        bloodPressure = bloodPressure == null ? "" : bloodPressure.trim();
        consciousness = consciousness == null ? "" : consciousness.trim();
        requiredFacilities = requiredFacilities == null ? List.of() : requiredFacilities;
        specialNotes = specialNotes == null ? "" : specialNotes.trim();
    }
}
