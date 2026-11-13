import React from 'react';
import { Text } from 'react-native';
import { Box } from './ui';
import { C, KTAS_COLORS } from './theme';

export default function ReportSummary({ report, showNotes = false }) {
  return (
    <Box label="완성된 환자 보고서">
      <Text style={{ fontSize: 13, color: C.ink, lineHeight: 20 }}>
        환자  {report.patient || '-'}{'\n'}
        주증상  {report.symptoms || '-'}{'\n'}
        혈압  {report.bp || '-'}   의식  {report.consciousness || '-'}{'\n'}
        KTAS  <Text style={{ fontWeight: '800', color: KTAS_COLORS[report.ktas - 1] }}>{report.ktas}등급</Text>{'\n'}
        필수 시설  {report.requiredFacilities.join(', ') || '-'}
        {showNotes && `\n특이사항  ${report.notes || '없음'}`}
      </Text>
    </Box>
  );
}
