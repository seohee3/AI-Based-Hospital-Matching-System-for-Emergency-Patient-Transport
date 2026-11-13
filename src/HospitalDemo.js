// One session alternates between a successful call and an all-declined call.
export class HospitalDemo {
  #originalCalls = 0;

  startOriginalCall() {
    this.#originalCalls += 1;
  }

  nextResponse(call) {
    if (call.outcome) return null;
    const index = call.hospitals.findIndex(hospital => hospital.status === 'pending');
    if (index < 0) return null;

    const shouldAccept = Boolean(call.retryOf) || this.#originalCalls % 2 === 1;
    const acceptingIndex = Math.min(1, call.hospitals.length - 1);
    return {
      hpid: call.hospitals[index].hpid,
      response: shouldAccept && index === acceptingIndex ? 'accepted' : 'declined',
    };
  }
}
