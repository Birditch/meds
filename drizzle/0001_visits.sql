CREATE TABLE "visits" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "visits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"date" date NOT NULL,
	CONSTRAINT "visits_date_key" UNIQUE("date")
);
