import React, { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { Screen, Header, Box, Btn, s } from '../ui';
import { C, KTAS_COLORS } from '../theme';

// A04 특이사항: 메모 확정 → 보고서 완성 → KTAS / 필수시설만 다음 담당자에게 전달
export default function Notes({ report, onHandoff, onBack }) {
  const [notes, setNotes] = useState(report.notes ?? '');
  const finalReport = { ...report, notes };

  return (
    <Screen>
      <Header title="특이사항" onBack={() => onBack(finalReport)} />

      <Box label="완성된 환자 보고서">
        <Text style={{ fontSize: 13, color: C.ink, lineHeight: 20 }}>
          환자  {finalReport.patient || '-'}{'\n'}
          주증상  {finalReport.symptoms || '-'}{'\n'}
          혈압  {finalReport.bp || '-'}   의식  {finalReport.consciousness || '-'}{'\n'}
          KTAS  <Text style={{ fontWeight: '800', color: KTAS_COLORS[finalReport.ktas - 1] }}>{finalReport.ktas}등급</Text>{'\n'}
          필수 시설  {finalReport.requiredFacilities.join(', ') || '-'}
        </Text>
      </Box>

      <Box label="특이사항 메모" style={{ minHeight: 150 }}>
        <TextInput
          style={[s.value, { minHeight: 120, textAlignVertical: 'top' }]}
          multiline
          value={notes}
          onChangeText={setNotes}
          placeholder="특이사항을 입력하세요"
        />
      </Box>

      <Btn
        title="병원 매칭 및 호출"
        color={C.red}
        // 보고서 전체는 넘기지 않고, KTAS 와 필수 시설만 다음 담당자에게 전달한다.
        onPress={() => onHandoff({ ktas: finalReport.ktas, requiredFacilities: finalReport.requiredFacilities })}
      />
    </Screen>
  );
}
