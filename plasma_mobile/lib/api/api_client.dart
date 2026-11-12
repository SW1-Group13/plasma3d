import 'dart:convert';
import 'dart:io';

import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import 'package:plasma_mobile/const/app_constants.dart';
import 'package:plasma_mobile/screens/auth/service/auth_controller.dart';

class ApiException implements Exception {
  ApiException(this.statusCode, this.message);

  final int statusCode;
  final String message;

  @override
  String toString() => message;
}

/// Cliente HTTP centralizado: base URL, cabeceras JWT y manejo de errores.
class ApiClient {
  ApiClient._();

  static Uri uri(String path) => Uri.parse('${AppConstants.apiBase}$path');

  static Map<String, String> headers({bool json = false}) {
    final auth = Get.isRegistered<AuthController>()
        ? Get.find<AuthController>()
        : null;
    final token = auth?.getToken();
    return {
      'Accept': 'application/json',
      if (json) 'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  static String mediaUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    return '${AppConstants.baseUrlPacht}$path';
  }

  static dynamic _decode(http.Response res) {
    if (res.body.isEmpty) return null;
    try {
      return jsonDecode(res.body);
    } catch (_) {
      return res.body;
    }
  }

  static String _errorMessage(http.Response res) {
    final body = _decode(res);
    if (body is Map) {
      final value = body['detail'] ?? body['error'] ?? body['message'];
      if (value != null) return value.toString();
      if (body.isNotEmpty) {
        final first = body.values.first;
        if (first is List && first.isNotEmpty) return first.first.toString();
        return first.toString();
      }
    }
    if (body is String && body.isNotEmpty) return body;
    return 'Error ${res.statusCode}';
  }

  static dynamic _handle(http.Response res) {
    if (res.statusCode >= 200 && res.statusCode < 300) return _decode(res);
    throw ApiException(res.statusCode, _errorMessage(res));
  }

  static Future<dynamic> get(String path) async =>
      _handle(await http.get(uri(path), headers: headers()));

  static Future<dynamic> postJson(
    String path,
    Map<String, dynamic> body,
  ) async =>
      _handle(
        await http.post(
          uri(path),
          headers: headers(json: true),
          body: jsonEncode(body),
        ),
      );

  static Future<dynamic> patchJson(
    String path,
    Map<String, dynamic> body,
  ) async =>
      _handle(
        await http.patch(
          uri(path),
          headers: headers(json: true),
          body: jsonEncode(body),
        ),
      );

  static Future<dynamic> delete(String path) async =>
      _handle(await http.delete(uri(path), headers: headers()));

  static Future<dynamic> postMultipart(
    String path, {
    required Map<String, String> fields,
    required String fileField,
    required File file,
  }) async {
    final request = http.MultipartRequest('POST', uri(path))
      ..headers.addAll(headers())
      ..fields.addAll(fields)
      ..files.add(await http.MultipartFile.fromPath(fileField, file.path));

    final streamed = await request.send();
    return _handle(await http.Response.fromStream(streamed));
  }
}
