class UserModel {
  const UserModel({
    this.id,
    required this.nombre,
    required this.email,
    this.password,
    this.rol = 'usuario_normal',
    this.telefono,
    this.url,
    this.fechaExpiracionPlan,
    this.fechaRegistro,
  });

  final int? id;
  final String nombre;
  final String email;
  final String? password;
  final String rol;
  final int? telefono;
  final String? url;
  final String? fechaExpiracionPlan;
  final String? fechaRegistro;

  bool get isPremium => rol == 'usuario_premium';

  String get inicial => nombre.trim().isEmpty
      ? '?'
      : nombre.trim().substring(0, 1).toUpperCase();

  String get avatarUrl => url ?? '';

  Map<String, dynamic> toJsonRegistro() => {
        'nombre': nombre,
        'email': email,
        'password': password,
        'rol': rol,
      };

  Map<String, dynamic> toJsonLogin() => {
        'email': email,
        'password': password,
      };

  factory UserModel.fromJson(Map<String, dynamic> json) {
    int? asInt(dynamic value) {
      if (value == null) return null;
      if (value is int) return value;
      return int.tryParse('$value');
    }

    return UserModel(
      id: asInt(json['id']),
      nombre: (json['nombre'] ?? '') as String,
      email: (json['email'] ?? '') as String,
      rol: (json['rol'] ?? 'usuario_normal') as String,
      telefono: asInt(json['telefono']),
      url: json['url'] as String?,
      fechaExpiracionPlan: json['fecha_expiracion_plan']?.toString(),
      fechaRegistro: json['fecha_registro']?.toString(),
    );
  }
}
