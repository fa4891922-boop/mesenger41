function ConfirmDialog({ confirmDialog, onConfirm, onCancel }) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-text">
          {confirmDialog.type === 'deleteChat'
            ? `Удалить чат с ${confirmDialog.name}? Сообщения будут удалены только у вас.`
            : 'Удалить сообщение у всех? Это действие нельзя отменить.'}
        </p>
        <div className="confirm-actions">
          <button className="confirm-btn cancel" onClick={onCancel}>Отмена</button>
          <button className="confirm-btn delete" onClick={onConfirm}>Удалить</button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
