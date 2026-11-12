import 'dart:io';

import 'package:plasma_mobile/api/api_client.dart';

/// Modelo de un plano/modelo 3D devuelto por el backend.
class ModelJob {
  const ModelJob({
    required this.id,
    this.planImage,
    this.glbModel,
    this.width = 0,
    this.height = 0,
    this.usuario,
    this.createdAt,
  });

  final int id;
  final String? planImage;
  final String? glbModel;
  final int width;
  final int height;
  final int? usuario;
  final String? createdAt;

  factory ModelJob.fromJson(Map<String, dynamic> json) {
    int asInt(dynamic value) {
      if (value is int) return value;
      return int.tryParse('${value ?? ''}') ?? 0;
    }

    return ModelJob(
      id: asInt(json['id']),
      planImage: json['plan_image'] as String?,
      glbModel: json['glb_model'] as String?,
      width: asInt(json['width']),
      height: asInt(json['height']),
      usuario: json['usuario'] == null ? null : asInt(json['usuario']),
      createdAt: json['created_at'] as String?,
    );
  }

  String get planImageUrl => ApiClient.mediaUrl(planImage);
  String get glbUrl => ApiClient.mediaUrl(glbModel);

  String get createdLabel {
    final value = createdAt;
    if (value == null || value.isEmpty) return '';
    return value.split('T').first;
  }

  bool get hasModel => glbModel != null && glbModel!.isNotEmpty;

  Map<String, dynamic> toJson() => {
        'id': id,
        'plan_image': planImage,
        'glb_model': glbModel,
        'width': width,
        'height': height,
        'usuario': usuario,
        'created_at': createdAt,
      };
}

class ModelsService {
  ModelsService._();

  static Future<List<ModelJob>> list() async {
    final data = await ApiClient.get('api/set_plan/lista_modelos/');
    if (data is List) {
      return data
          .whereType<Map>()
          .map((item) => ModelJob.fromJson(Map<String, dynamic>.from(item)))
          .toList();
    }
    return const [];
  }

  static Future<ModelJob> uploadPlan(
    File file, {
    required int usuario,
  }) async {
    final data = await ApiClient.postMultipart(
      'api/set_plan/plans/',
      fields: {'usuario': '$usuario'},
      fileField: 'plan_file',
      file: file,
    );
    return ModelJob.fromJson(Map<String, dynamic>.from(data as Map));
  }

  static Future<ModelJob> createEmpty({required int usuario}) async {
    final data = await ApiClient.postJson(
      'api/set_plan/plans/empty/',
      {'usuario': usuario},
    );
    return ModelJob.fromJson(Map<String, dynamic>.from(data as Map));
  }

  static Future<void> delete(int id) async {
    await ApiClient.delete('api/set_plan/plans/$id/');
  }
}
