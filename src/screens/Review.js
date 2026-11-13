import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Screen, Header, Box, Btn, Chip, s } from '../ui';
import { C, KTAS_COLORS } from '../theme';
import { FACILITIES } from '../constants';

// A03 AI 리포트 검수: 항목 확인/수정 + KTAS 직접 선택 + 필수 시설 선택
// initial: A04 에서 이전 버튼으로 돌아왔을 때 입력값을 복원하기 위한 값
export default function Review({ draft, initial, onNext, onBack }) {
  const [patient, setPatient] = useState(initial?.patient ?? [draft.age, draft.sex].filter(Boolean).join(' · '));
  const [symptoms, setSymptoms] = useState(initial?.symptoms ?? draft.chiefComplaints.join(' · '));
  const [bp, setBp] = useState(initial?.bp ?? draft.bloodPressure);
  const [consciousness, setConsciousness] = useState(initial?.consciousness ?? draft.consciousness);
  const [ktas, setKtas] = useState(initial?.ktas ?? null);
  const [selected, setSelected] = useState(initial?.requiredFacilities ?? draft.requiredFacilities); // AI 추천을 초기 선택으로

  const toggle = (f) => setSelected((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <Screen>
      <Header title="리포트 검수" onBack={onBack} />

      <View style={s.grid}>
        <Box label="환자" style={s.cell}><TextInput style={s.value} value={patient} onChangeText={setPatient} /></Box>
        <Box label="주증상" style={s.cell}><TextInput style={s.value} value={symptoms} onChangeText={setSymptoms} /></Box>
        <Box label="혈압" style={s.cell}><TextInput style={s.value} value={bp} onChangeText={setBp} /></Box>
        <Box label="의식" style={s.cell}><TextInput style={s.value} value={consciousness} onChangeText={setConsciousness} /></Box>
      </View>

      <Box label="KTAS 등급 (직접 선택)">
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {KTAS_COLORS.map((color, i) => {
            const level = i + 1;
            const on = ktas === level;
            return (
              <TouchableOpacity
                key={level}
                activeOpacity={0.8}
                onPress={() => setKtas(level)}
                style={{
                  flex: 1, height: 46, borderRadius: 9, backgroundColor: color, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 3, borderColor: on ? C.navy : 'transparent',
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{level}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Box>

      <Box label="필수 시설">
        <View style={[s.row, { marginTop: 4 }]}>
          {FACILITIES.map((f) => (
            <Chip key={f} text={f} on={selected.includes(f)} onPress={() => toggle(f)} />
          ))}
        </View>
      </Box>

      <Btn
        title="확인 완료 · 다음"
        disabled={!ktas}
        onPress={() =>
          onNext({
            patient, symptoms, bp, consciousness, ktas,
            requiredFacilities: FACILITIES.filter((f) => selected.includes(f)),
          })
        }
      />
    </Screen>
  );
}
