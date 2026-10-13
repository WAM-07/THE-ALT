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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6">
          <div 
            className="absolute inset-0 bg-[#000000e0] backdrop-blur-xl animate-in fade-in duration-500" 
            onClick={modal.type === 'alert' ? modal.onConfirm : modal.onCancel}
          ></div>
          
          <div className="relative w-full max-w-md bg-[#050505] border border-green-500/20 rounded-[40px] p-10 shadow-[0_0_100px_rgba(34,197,94,0.1)] overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Structural Accents */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-green-500/5 blur-[100px] rounded-full"></div>
            <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-green-500/5 blur-[100px] rounded-full"></div>
            
            <div className="text-center relative z-10">
              <div className="w-20 h-20 bg-gradient-to-tr from-green-600/20 to-green-400/10 rounded-[24px] flex items-center justify-center mx-auto mb-8 border border-green-500/30 shadow-[0_0_40px_rgba(34,197,94,0.15)]">
                <span className="text-3xl filter drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]">
                  {modal.type === 'confirm' ? '🛡️' : '🛸'}
                </span>
              </div>
              
              <h3 className="text-2xl font-black text-white mb-3 uppercase tracking-[-0.02em] leading-tight">
                {modal.title}
              </h3>
              <p className="text-sm text-white/50 font-medium leading-relaxed mb-10 px-4">
                {modal.message}
              </p>
              
              <div className="flex gap-4">
                {modal.type === "confirm" && (
                  <button
                    onClick={modal.onCancel}
                    className="flex-1 px-8 py-5 rounded-2xl bg-white/5 border border-white/5 text-white/40 font-black text-[10px] uppercase tracking-[0.3em] hover:bg-white/10 hover:text-white transition-all active:scale-95"
                  >
                    Abort
                  </button>
                )}
                <button
                  onClick={modal.onConfirm}
                  className="flex-1 px-8 py-5 rounded-2xl bg-gradient-to-r from-green-600 to-green-400 text-white font-black text-[10px] uppercase tracking-[0.3em] shadow-[0_20px_40px_rgba(34,197,94,0.25)] hover:shadow-[0_20px_50px_rgba(34,197,94,0.4)] transition-all active:scale-95 relative overflow-hidden group"
                >
                  <span className="relative z-10">{modal.type === "confirm" ? "Confirm" : "Synchronize"}</span>
                  <div className="absolute inset-0 bg-white/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 skew-x-12"></div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
};

export const useModal = () => useContext(ModalContext);
