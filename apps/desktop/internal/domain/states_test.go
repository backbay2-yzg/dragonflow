package domain

import "testing"

func TestStateTransitions(t *testing.T) {
	if !CanTransition(StatusNew, StatusTriaging) {
		t.Fatal("expected NEW -> TRIAGING to be valid")
	}
	if !CanTransition(StatusTriaging, StatusTriaging) {
		t.Fatal("expected self transition to be valid")
	}
	if CanTransition(StatusNew, StatusPrOpen) {
		t.Fatal("expected NEW -> PR_OPEN to be invalid")
	}
	if CanTransition(StatusReleased, StatusImplementing) {
		t.Fatal("expected RELEASED -> IMPLEMENTING to be invalid")
	}
	if !IsTerminalStatus(StatusReleased) || !IsTerminalStatus(StatusCancelled) || !IsTerminalStatus(StatusFailed) {
		t.Fatal("expected terminal statuses to match")
	}
	if IsTerminalStatus(StatusImplementing) {
		t.Fatal("expected IMPLEMENTING not to be terminal")
	}
	if len(AllTaskStatuses) != 20 {
		t.Fatalf("expected 20 statuses, got %d", len(AllTaskStatuses))
	}
}
