import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { Screen, Header, Box, Btn, s } from '../ui';
import { C } from '../theme';
import ReportSummary from '../ReportSummary';

export default function Notes({ report, matching, openingCall, resuming, onHandoff, onBack }) {
  const [notes, setNotes] = useState(report.notes ?? '');
  const finalReport = { ...report, notes };

  return (
    <Screen>
      <Header title="특이사항" onBack={() => onBack(finalReport)} />

      <ReportSummary report={finalReport} />

      <Box label="특이사항 메모" style={{ minHeight: 150 }}>
        <TextInput
          style={[s.value, { minHeight: 120, textAlignVertical: 'top' }]}
          multiline
          editable={!matching && !resuming}
          value={notes}
          onChangeText={setNotes}
          placeholder="특이사항을 입력하세요"
        />
      </Box>

      <Btn
        title={openingCall ? '호출 정보 불러오는 중…' : matching ? '후보 병원 찾는 중…' : resuming ? '기존 호출 이어가기' : '병원 매칭 및 호출'}
        disabled={matching}
        color={C.red}
        onPress={() => onHandoff(finalReport)}
      />
    </Screen>
  );
}
