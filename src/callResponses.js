export function startCall(hospitals) {
  return hospitals.map(hospital => ({ ...hospital, status: 'pending' }));
}

export function respondToCall(hospitals, { hpid, response }) {
  if (response === 'cancelled') {
    if (!hospitals.some(h => h.status === 'pending')) return hospitals;
    return hospitals.map(h => h.status === 'pending' ? { ...h, status: 'cancelled' } : h);
  }
  if (response !== 'accepted' && response !== 'declined') return hospitals;
  if (!hospitals.some(h => h.hpid === hpid && h.status === 'pending')) return hospitals;

  return hospitals.map(hospital => {
    if (hospital.status !== 'pending') return hospital;
    if (hospital.hpid === hpid) return { ...hospital, status: response };
    if (response === 'accepted') return { ...hospital, status: 'closed' };
    return hospital;
  });
}
export const statusText = {
  pending: '응답 대기', accepted: '수락', declined: '거절',
  closed: '타 병원 확정으로 종료', cancelled: '호출 취소로 종료',
};

export const outcomeText = { confirmed: '이송 병원 확정', declined: '전체 거절', cancelled: '호출 취소' };

export function outcomeOf(hospitals) {
  if (hospitals.some(h => h.status === 'pending')) return null;
  if (hospitals.some(h => h.status === 'accepted')) return 'confirmed';
  return hospitals.some(h => h.status === 'cancelled') ? 'cancelled' : 'declined';
}
