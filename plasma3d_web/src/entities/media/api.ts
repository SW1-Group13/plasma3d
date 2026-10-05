import { http } from '@/shared/api/http';

export const mediaApi = {
  async uploadImage(file: File): Promise<{ url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await http.post<{ url: string }>('api/media/upload/', formData);
    return data;
  },
};
