"use client";
import { createContext, useContext, useState, useCallback } from "react";

const ModalContext = createContext();

export const ModalProvider = ({ children }) => {
  const [modal, setModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    type: "alert", // alert, confirm
    onConfirm: null,
    onCancel: null,
  });

  const showAlert = useCallback((title, message) => {
    setModal({
      isOpen: true,
      title,
      message,
      type: "alert",
      onConfirm: () => setModal(prev => ({ ...prev, isOpen: false })),
    });
  }, []);

  const showConfirm = useCallback((title, message, onConfirm, onCancel) => {
    setModal({
      isOpen: true,
      title,
      message,
      type: "confirm",
      onConfirm: () => {
        if (onConfirm) onConfirm();
        setModal(prev => ({ ...prev, isOpen: false }));
      },
      onCancel: () => {
        if (onCancel) onCancel();
        setModal(prev => ({ ...prev, isOpen: false }));
      },
    });
  }, []);

  return (
    <ModalContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      {modal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={modal.type === "alert" ? modal.onConfirm : modal.onCancel}></div>
          <div role="dialog" aria-modal="true" aria-labelledby="altar-dialog-title" className="relative w-full max-w-sm rounded-[28px] border border-line bg-surface p-7 shadow-card">
            <h3 id="altar-dialog-title" className="font-display text-xl font-bold">
              {modal.title}
            </h3>
            <p className="mt-2 leading-relaxed text-ink-2">{modal.message}</p>
            <div className="mt-6 flex gap-2">
              {modal.type === "confirm" && (
                <button onClick={modal.onCancel} className="h-11 flex-1 rounded-full border border-line font-semibold hover:border-ink/30">
                  Cancel
                </button>
              )}
              <button onClick={modal.onConfirm} autoFocus className="h-11 flex-1 rounded-full bg-pop font-semibold text-pop-ink hover:opacity-90">
                {modal.type === "confirm" ? "Confirm" : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
};

export const useModal = () => useContext(ModalContext);
