function ConfirmDialog({ confirmDialog, onConfirm, onCancel }) {
  const isChatDelete = confirmDialog.type === 'deleteChat';

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-text">
          {isChatDelete
            ? `Удалить чат с ${confirmDialog.name}?`
            : 'Удалить сообщение у всех? Это действие нельзя отменить.'}
        </p>
        <div className="confirm-actions">
          <button className="confirm-btn cancel" onClick={onCancel}>Отмена</button>
          {isChatDelete ? (
            <>
              <button className="confirm-btn delete" onClick={() => onConfirm(false)}>
                Удалить у меня
              </button>
              <button className="confirm-btn delete danger-full" onClick={() => onConfirm(true)}>
                Удалить у всех
              </button>
            </>
          ) : (
            <button className="confirm-btn delete" onClick={() => onConfirm()}>Удалить</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
