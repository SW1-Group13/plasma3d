import { create } from 'zustand';
import { http } from '@/shared/api/http';
import type { ResponseBlockchain, VerifyPlan } from '@/entities/blockchain/types';

interface BlockchainStore {
  imageToVerify: VerifyPlan;
  setImageToVerify: (plan: VerifyPlan) => void;
  verify: (image: File, id: number, json: File, model: File) => Promise<ResponseBlockchain>;
}

export const useBlockchainStore = create<BlockchainStore>((set) => ({
  imageToVerify: { id: 0, url: '' },
  setImageToVerify: (plan) => set({ imageToVerify: plan }),

  verify: async (image, id, json, model) => {
    const formData = new FormData();
    formData.append('job_id', id.toString());
    formData.append('json_file', json);
    formData.append('model_file', model);
    formData.append('img_file', image);
    const { data } = await http.post<ResponseBlockchain>(
      'api/set_plan/validar_plano/',
      formData,
    );
    return data;
  },
}));
