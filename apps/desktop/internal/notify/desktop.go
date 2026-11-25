package notify

import (
	"fmt"
	"sync"

	"github.com/dragonflow/desktop/internal/domain"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

type DesktopToastBridge struct {
	mu            sync.RWMutex
	service       *notifications.NotificationService
	enabled       bool
	events        map[domain.NotificationEventType]bool
	onFocusTask   func(taskID string)
	idCounter     int64
	taskByNotifID map[string]string
}

func NewDesktopToastBridge(service *notifications.NotificationService, enabled bool, events []domain.NotificationEventType, onFocusTask func(taskID string)) *DesktopToastBridge {
	b := &DesktopToastBridge{
		service:       service,
		onFocusTask:   onFocusTask,
		taskByNotifID: make(map[string]string),
	}
	b.UpdateSettings(enabled, events)
	if service != nil {
		service.OnNotificationResponse(func(result notifications.NotificationResult) {
			if b.onFocusTask == nil {
				return
			}
			taskID := ""
			if result.Response.UserInfo != nil {
				if tid, ok := result.Response.UserInfo["taskId"].(string); ok {
					taskID = tid
				}
			}
			if taskID == "" && result.Response.ID != "" {
				b.mu.RLock()
				taskID = b.taskByNotifID[result.Response.ID]
				b.mu.RUnlock()
			}
			if taskID != "" {
				b.onFocusTask(taskID)
			}
		})
	}
	return b
}

func (b *DesktopToastBridge) UpdateSettings(enabled bool, events []domain.NotificationEventType) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.enabled = enabled
	m := make(map[domain.NotificationEventType]bool, len(events))
	for _, ev := range events {
		m[ev] = true
	}
	b.events = m
}

func (b *DesktopToastBridge) NotifyDesktop(msg NotificationMessage) {
	b.mu.RLock()
	enabled := b.enabled
	allowed := b.events[msg.Event]
	svc := b.service
	b.mu.RUnlock()

	if !enabled || !allowed || svc == nil {
		return
	}

	b.mu.Lock()
	b.idCounter++
	id := fmt.Sprintf("dragonflow-%s-%d", msg.Event, b.idCounter)
	if msg.TaskID != "" {
		b.taskByNotifID[id] = msg.TaskID
	}
	b.mu.Unlock()

	title := fmt.Sprintf("DragonFlow #%d · %s", msg.IssueNumber, toastEventTitle(msg.Event))
	_ = svc.SendNotification(notifications.NotificationOptions{
		ID:       id,
		Title:    title,
		Subtitle: msg.Title,
		Body:     msg.Summary,
		ThreadID: msg.TaskID,
		Data: map[string]any{
			"taskId": msg.TaskID,
			"event":  string(msg.Event),
		},
	})
}

func toastEventTitle(ev domain.NotificationEventType) string {
	switch ev {
	case domain.NotifyPlanAwaitingApproval:
		return "待审批方案"
	case domain.NotifyReadyToMerge:
		return "PR 已就绪待合并"
	case domain.NotifyNeedsHuman:
		return "需要人工介入"
	case domain.NotifyReleased:
		return "已正式发版"
	case domain.NotifyFailed:
		return "任务执行失败"
	case domain.NotifyAgentFallback:
		return "Agent 自动降级"
	case domain.NotifyPrOpened:
		return "PR 已创建"
	default:
		return string(ev)
	}
}
